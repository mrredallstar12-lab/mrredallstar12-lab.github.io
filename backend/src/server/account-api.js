import { randomUUID } from "node:crypto";
import { AccountRepository } from "../repositories/account-repository.js";
import { AuditRepository } from "../repositories/audit-repository.js";
import { AuthRepository } from "../repositories/auth-repository.js";
import { InventoryRepository } from "../repositories/inventory-repository.js";
import { MeInventoryRepository } from "../repositories/me-inventory-repository.js";
import { PlayerStateRepository } from "../repositories/player-state-repository.js";
import { RateLimitRepository } from "../repositories/rate-limit-repository.js";
import { digestSensitiveValue } from "../security/field-crypto.js";
import { clearSessionCookie, jsonResponse, parseCookies, publicAccount, readJson, sessionCookie } from "../security/http.js";
import { validateUsername } from "../security/username.js";

function isStagingEnabled(config) {
  return ["development", "staging", "test"].includes(config.envName);
}

function repos(env, config) {
  const options = {
    sessionPepper: config.sessionPepper,
    identityPepper: config.identityPepper,
    fieldEncryptionKey: config.fieldEncryptionKey,
    fieldEncryptionKeyId: config.fieldEncryptionKeyId
  };
  return {
    account: new AccountRepository(env.DB, options),
    auth: new AuthRepository(env.DB, options),
    audit: new AuditRepository(env.DB),
    inventory: new InventoryRepository(env.DB),
    meInventory: new MeInventoryRepository(env.DB),
    player: new PlayerStateRepository(env.DB),
    rateLimit: new RateLimitRepository(env.DB)
  };
}

async function actorFromRequest(request, env, config) {
  const cookies = parseCookies(request.headers.get("Cookie") || "");
  const token = cookies.ofa_session;
  if (!token) return null;
  const auth = new AuthRepository(env.DB, { sessionPepper: config.sessionPepper });
  const session = await auth.findActiveSessionByToken(token);
  if (!session?.account_id) return null;
  return { session, accountId: session.account_id };
}

async function requireActor(request, env, config) {
  const actor = await actorFromRequest(request, env, config);
  if (!actor) return { response: jsonResponse({ ok: false, error: { code: "auth_required", message: "Authentication required." } }, 401) };
  return { actor };
}

async function requireCsrf(request, actor, env, config) {
  const got = request.headers.get("X-OFA-CSRF") || "";
  if (!got) return false;
  const auth = new AuthRepository(env.DB, { sessionPepper: config.sessionPepper });
  return await auth.verifyCsrf(actor.session.id, got);
}

async function rateLimitAuthenticatedOperation({ repos, actor, operation, normalLimit, ownerLimit, windowSeconds }) {
  const isOwner = await repos.auth.hasRole(actor.accountId, "owner");
  const limit = isOwner ? ownerLimit : normalLimit;
  return await repos.rateLimit.check(`account-op:${operation}:${actor.accountId}`, limit, windowSeconds);
}

function genericAuthStarted() {
  return jsonResponse({ ok: true, message: "If the account can receive a sign-in link, one has been prepared." }, 202);
}

function validEmailForStaging(email) {
  const value = String(email || "").trim();
  return value.length >= 6 && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function noStore(headers = {}) {
  return { "Cache-Control": "no-store", ...headers };
}

const PHASE4_STAGING_DISCOVERY_KEYS = new Set([
  "phase4.signal001.transcript",
  "phase4.caseecho.personnel",
  "phase4.relationship.echo",
  "phase4.withheld.null"
]);

export async function handleAccountApi(request, env, config, logger) {
  if (!env.DB) return jsonResponse({ ok: false, error: { code: "db_unavailable", message: "Database unavailable." } }, 503);
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "");
  const r = repos(env, config);
  const requestId = request.headers.get("X-Request-Id") || randomUUID();

  if (path === "/api/v1/auth/register" && request.method === "POST") {
    const body = await readJson(request);
    const checked = validateUsername(body.username);
    if (!checked.ok) return jsonResponse({ ok: false, error: { code: checked.code, message: checked.message } }, 400);
    if (!validEmailForStaging(body.email)) return jsonResponse({ ok: false, error: { code: "invalid_email", message: "Email address is invalid." } }, 400);
    const limited = await r.rateLimit.check(`register:${digestSensitiveValue(body.email || "", config.identityPepper)}`, 5, 3600);
    if (!limited.ok) return jsonResponse({ ok: false, error: { code: "rate_limited", message: "Try again later." } }, 429);
    const created = await r.account.createAccountWithEmail({ username: body.username, email: body.email });
    if (!created.ok) return jsonResponse({ ok: false, error: { code: created.error.code, message: created.error.message } }, 400);
    await r.audit.record({ actorType: "system", action: "account.register", resourceType: "account", resourceId: created.accountId, result: "created", requestId });
    return jsonResponse({ ok: true, account: { username: created.username, archiveIdentity: { designation: created.archiveDesignation } } }, 201, noStore());
  }

  if (path === "/api/v1/auth/email/start" && request.method === "POST") {
    const body = await readJson(request);
    const emailDigest = r.account.emailDigest(body.email || "");
    const limited = await r.rateLimit.check(`email-start:${emailDigest}`, 8, 3600);
    if (!limited.ok) return jsonResponse({ ok: false, error: { code: "rate_limited", message: "Try again later." } }, 429);
    const account = await r.account.findByEmailDigest(emailDigest);
    if (account && isStagingEnabled(config) && config.localEmailLinksEnabled) {
      const challenge = await r.auth.createEmailChallenge({ purpose: "signin", emailDigest, accountId: account.id, ttlSeconds: 900, requestId });
      logger.warn("local_staging_email_link", { purpose: "signin", username: account.username_display, token: challenge.token, expiresAt: challenge.expiresAt });
    }
    await r.audit.record({ actorType: "anonymous", action: "auth.email.start", result: "accepted", requestId, context: { localStaging: isStagingEnabled(config) } });
    return genericAuthStarted();
  }

  if (path === "/api/v1/auth/email/complete" && request.method === "POST") {
    const body = await readJson(request);
    const limited = await r.rateLimit.check(`email-complete:${request.headers.get("host") || "local"}`, 30, 900);
    if (!limited.ok) return jsonResponse({ ok: false, error: { code: "rate_limited", message: "Try again later." } }, 429);
    const challenge = await r.auth.consumeEmailChallenge({ purpose: "signin", token: body.token || "" });
    if (!challenge?.account_id) {
      await r.audit.record({ actorType: "anonymous", action: "auth.email.complete", result: "denied", requestId });
      return jsonResponse({ ok: false, error: { code: "invalid_or_expired_token", message: "Sign-in link is invalid or expired." } }, 400);
    }
    const session = await r.auth.createSession({ accountId: challenge.account_id, ttlSeconds: config.sessionTtlSeconds, metadata: { method: "email_link" } });
    await r.audit.record({ actorType: "account", actorId: challenge.account_id, action: "auth.email.complete", result: "allowed", requestId });
    return jsonResponse({ ok: true }, 200, noStore({
      "Set-Cookie": sessionCookie(session.token, config, config.sessionTtlSeconds),
      "X-OFA-CSRF": session.csrfToken
    }));
  }

  if (path === "/api/v1/auth/logout" && request.method === "POST") {
    const required = await requireActor(request, env, config);
    if (required.response) return required.response;
    if (!(await requireCsrf(request, required.actor, env, config))) return jsonResponse({ ok: false, error: { code: "csrf_required", message: "CSRF validation failed." } }, 403);
    await r.auth.revokeSession(required.actor.session.id, "logout");
    await r.audit.record({ actorType: "account", actorId: required.actor.accountId, action: "auth.logout", result: "revoked", requestId });
    return jsonResponse({ ok: true }, 200, noStore({ "Set-Cookie": clearSessionCookie(config) }));
  }

  if (path === "/api/v1/me" && request.method === "GET") {
    const required = await requireActor(request, env, config);
    if (required.response) return required.response;
    const account = await r.account.publicAccountById(required.actor.accountId);
    const csrfToken = await r.auth.rotateCsrf(required.actor.session.id);
    return jsonResponse({ ok: true, account: publicAccount(account) }, 200, noStore({ "X-OFA-CSRF": csrfToken }));
  }

  if (path === "/api/v1/me/discoveries" && request.method === "GET") {
    const required = await requireActor(request, env, config);
    if (required.response) return required.response;
    return jsonResponse({ ok: true, discoveries: await r.player.discoveries(required.actor.accountId) }, 200, noStore());
  }

  if (path === "/api/v1/me/discoveries" && request.method === "POST") {
    const required = await requireActor(request, env, config);
    if (required.response) return required.response;
    if (!(await requireCsrf(request, required.actor, env, config))) return jsonResponse({ ok: false, error: { code: "csrf_required", message: "CSRF validation failed." } }, 403);
    const limited = await rateLimitAuthenticatedOperation({ repos: r, actor: required.actor, operation: "me.discoveries.create", normalLimit: 20, ownerLimit: 500, windowSeconds: 3600 });
    if (!limited.ok) return jsonResponse({ ok: false, error: { code: "rate_limited", message: "Try again later." } }, 429, noStore());
    const body = await readJson(request);
    if (body.discoveryType === "phase4_staging" && !PHASE4_STAGING_DISCOVERY_KEYS.has(body.discoveryKey)) {
      return jsonResponse({ ok: false, error: { code: "unsupported_discovery", message: "Discovery is not available through this staging route." } }, 400, noStore());
    }
    await r.player.addDiscovery({ accountId: required.actor.accountId, discoveryType: body.discoveryType || "flag", discoveryKey: body.discoveryKey || "", provenance: { source: "phase3_staging" } });
    return jsonResponse({ ok: true }, 201, noStore());
  }

  if (path === "/api/v1/me/inventory" && request.method === "GET") {
    const required = await requireActor(request, env, config);
    if (required.response) return required.response;
    return jsonResponse({ ok: true, inventory: await r.meInventory.list(required.actor.accountId) }, 200, noStore());
  }

  if (path === "/api/v1/staging/grant-test-item" && request.method === "POST") {
    if (!isStagingEnabled(config)) return jsonResponse({ ok: false, error: { code: "staging_only", message: "Unavailable." } }, 404);
    const required = await requireActor(request, env, config);
    if (required.response) return required.response;
    if (!(await requireCsrf(request, required.actor, env, config))) return jsonResponse({ ok: false, error: { code: "csrf_required", message: "CSRF validation failed." } }, 403);
    const limited = await rateLimitAuthenticatedOperation({ repos: r, actor: required.actor, operation: "staging.grant-test-item", normalLimit: 20, ownerLimit: 500, windowSeconds: 3600 });
    if (!limited.ok) return jsonResponse({ ok: false, error: { code: "rate_limited", message: "Try again later." } }, 429, noStore());
    let definition = await env.DB.prepare("SELECT id FROM inventory_item_definitions WHERE item_key = 'phase3_static_receipt'").first();
    if (!definition) {
      const id = await r.inventory.createDefinition({ itemKey: "phase3_static_receipt", name: "Phase 3 Static Receipt", itemType: "staging-proof", stackable: true, publicMetadata: { phase: 3 }, secretMetadata: { neverSendToClient: true } });
      definition = { id };
    }
    const grant = await r.inventory.grantQuantity({ accountId: required.actor.accountId, itemDefinitionId: definition.id, quantity: 1, provenance: { source: "staging_grant" }, idempotencyKey: `phase3-static-receipt:${required.actor.accountId}` });
    return jsonResponse({ ok: true, grant: { idempotent: grant.idempotent } }, 201, noStore());
  }

  return null;
}

export { isStagingEnabled };

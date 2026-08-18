import { randomUUID } from "node:crypto";
import { AdminRepository } from "../repositories/admin-repository.js";
import { ArchiveSurfaceRepository } from "../repositories/archive-surface-repository.js";
import { AuditRepository } from "../repositories/audit-repository.js";
import { AuthRepository } from "../repositories/auth-repository.js";
import { InventoryRepository } from "../repositories/inventory-repository.js";
import { MeInventoryRepository } from "../repositories/me-inventory-repository.js";
import { OperationalModeRepository } from "../repositories/operational-mode-repository.js";
import { ProgressionDefinitionRepository } from "../repositories/progression-definition-repository.js";
import { ProgressionRepository } from "../repositories/progression-repository.js";
import { ProgressionEngine } from "../progression/engine.js";
import { buildActorContext, filterRecord } from "../archive/visibility-service.js";
import { jsonResponse, parseCookies, readJson, sessionCookie } from "../security/http.js";

const ELEVATION_TTL_SECONDS = 600;
const FRESH_AUTH_WINDOW_SECONDS = 300;

function noStore(headers = {}) {
  return { "Cache-Control": "no-store", ...headers };
}

function isStagingAdminHelperEnabled(config) {
  return ["development", "staging", "test"].includes(config.envName);
}

function repos(env, config) {
  return {
    admin: new AdminRepository(env.DB),
    archive: new ArchiveSurfaceRepository(env.DB),
    audit: new AuditRepository(env.DB),
    auth: new AuthRepository(env.DB, { sessionPepper: config.sessionPepper }),
    inventory: new InventoryRepository(env.DB),
    meInventory: new MeInventoryRepository(env.DB),
    modes: new OperationalModeRepository(env.DB),
    progressionDefinitions: new ProgressionDefinitionRepository(env.DB),
    progression: new ProgressionRepository(env.DB)
  };
}

async function adminActor(request, env, config, requiredPermission = "admin.access") {
  const cookies = parseCookies(request.headers.get("Cookie") || "");
  const token = cookies.ofa_session;
  if (!token) return { response: jsonResponse({ ok: false, error: { code: "admin_auth_required", message: "Admin authorization required." } }, 401, noStore()) };
  const r = repos(env, config);
  const session = await r.auth.findActiveSessionByToken(token);
  if (!session?.account_id) return { response: jsonResponse({ ok: false, error: { code: "admin_auth_required", message: "Admin authorization required." } }, 401, noStore()) };
  if (!(await r.auth.hasPermission(session.account_id, requiredPermission))) {
    return { response: jsonResponse({ ok: false, error: { code: "admin_forbidden", message: "Admin permission denied." } }, 403, noStore()) };
  }
  return { actor: { accountId: session.account_id, session }, repos: r };
}

async function requireCsrf(request, actor, r) {
  const got = request.headers.get("X-OFA-CSRF") || "";
  if (!got) return false;
  return await r.auth.verifyCsrf(actor.session.id, got);
}

async function requireElevation(actor, r) {
  return await r.admin.activeElevation(actor.session.id);
}

async function checkAdminRate(r, actor, operation, limit = 60, windowSeconds = 3600) {
  const bucket = `admin-op:${operation}:${actor.accountId}`;
  const row = await r.admin.db.prepare("SELECT count, reset_at FROM auth_rate_limits WHERE bucket_key = ?").bind(bucket).first();
  const now = Math.floor(Date.now() / 1000);
  const resetAt = now + windowSeconds;
  if (!row || Number(row.reset_at) <= now) {
    await r.admin.db.prepare("INSERT OR REPLACE INTO auth_rate_limits (bucket_key, count, reset_at) VALUES (?, 1, ?)").bind(bucket, resetAt).run();
    return { ok: true };
  }
  if (Number(row.count) >= limit) return { ok: false };
  await r.admin.db.prepare("UPDATE auth_rate_limits SET count = count + 1 WHERE bucket_key = ?").bind(bucket).run();
  return { ok: true };
}

function bodyError(code, message, status = 400) {
  return jsonResponse({ ok: false, error: { code, message } }, status, noStore());
}

async function dangerousGate({ request, actor, r, confirm, operation, limit = 20 }) {
  if (!(await requireCsrf(request, actor, r))) return bodyError("csrf_required", "CSRF validation failed.", 403);
  const limited = await checkAdminRate(r, actor, operation, limit, 3600);
  if (!limited.ok) return bodyError("rate_limited", "Try again later.", 429);
  const elevation = await requireElevation(actor, r);
  if (!elevation) return bodyError("admin_elevation_required", "Recent privileged elevation required.", 403);
  const body = await readJson(request);
  if (body.confirm !== confirm) return bodyError("confirmation_required", `Confirmation must be ${confirm}.`, 400);
  return { body, elevation };
}

export async function isAdminPageAllowed(request, env, config) {
  if (!env.DB) return false;
  const required = await adminActor(request, env, config, "admin.access");
  return !!required.actor;
}

export async function handleAdminApi(request, env, config) {
  if (!env.DB) return jsonResponse({ ok: false, error: { code: "db_unavailable", message: "Database unavailable." } }, 503, noStore());
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "");
  const requestId = request.headers.get("X-Request-Id") || randomUUID();

  if (path === "/api/v1/admin/me" && request.method === "GET") {
    const required = await adminActor(request, env, config, "admin.access");
    if (required.response) return required.response;
    const { actor, repos: r } = required;
    const roles = await r.admin.roles(actor.accountId);
    const permissions = await r.admin.permissions(actor.accountId);
    const elevation = await r.admin.activeElevation(actor.session.id);
    const csrfToken = await r.auth.rotateCsrf(actor.session.id);
    await r.audit.record({ actorType: "account", actorId: actor.accountId, action: "admin.me.read", result: "allowed", requestId });
    return jsonResponse({ ok: true, admin: { roles: roles.map((role) => role.role_key), permissions, elevated: !!elevation, elevationExpiresAt: elevation?.expires_at || null } }, 200, noStore({ "X-OFA-CSRF": csrfToken }));
  }

  if (path === "/api/v1/admin/elevation/start" && request.method === "POST") {
    const required = await adminActor(request, env, config, "admin.access");
    if (required.response) return required.response;
    const { actor, repos: r } = required;
    if (!(await requireCsrf(request, actor, r))) return bodyError("csrf_required", "CSRF validation failed.", 403);
    await r.audit.record({ actorType: "account", actorId: actor.accountId, action: "admin.elevation.start", result: "accepted", requestId });
    return jsonResponse({ ok: true, message: "Complete a fresh email-link sign-in, then confirm elevation from the new session." }, 202, noStore());
  }

  if (path === "/api/v1/admin/elevation/confirm" && request.method === "POST") {
    const required = await adminActor(request, env, config, "admin.access");
    if (required.response) return required.response;
    const { actor, repos: r } = required;
    if (!(await requireCsrf(request, actor, r))) return bodyError("csrf_required", "CSRF validation failed.", 403);
    const body = await readJson(request);
    if (body.confirm !== "ELEVATE") return bodyError("confirmation_required", "Confirmation must be ELEVATE.", 400);
    if (Date.now() - Date.parse(actor.session.issued_at) > FRESH_AUTH_WINDOW_SECONDS * 1000) {
      await r.audit.record({ actorType: "account", actorId: actor.accountId, action: "admin.elevation.confirm", result: "denied_stale_auth", requestId });
      return bodyError("fresh_auth_required", "Fresh authentication required for privileged elevation.", 403);
    }
    const elevation = await r.admin.createElevation({ sessionId: actor.session.id, accountId: actor.accountId, ttlSeconds: ELEVATION_TTL_SECONDS, requestId });
    await r.audit.record({ actorType: "account", actorId: actor.accountId, action: "admin.elevation.confirm", result: "allowed", requestId, context: { expiresAt: elevation.expiresAt } });
    return jsonResponse({ ok: true, elevation: { expiresAt: elevation.expiresAt } }, 200, noStore());
  }

  if (path === "/api/v1/admin/staging/fresh-auth-session" && request.method === "POST") {
    if (!isStagingAdminHelperEnabled(config)) return bodyError("not_found", "Not found.", 404);
    const required = await adminActor(request, env, config, "admin.access");
    if (required.response) return required.response;
    const { actor, repos: r } = required;
    if (!(await requireCsrf(request, actor, r))) return bodyError("csrf_required", "CSRF validation failed.", 403);
    const limited = await checkAdminRate(r, actor, "staging.fresh_auth_session", 20, 3600);
    if (!limited.ok) return bodyError("rate_limited", "Try again later.", 429);
    const session = await r.auth.createSession({
      accountId: actor.accountId,
      ttlSeconds: config.sessionTtlSeconds,
      metadata: { source: "admin_staging_fresh_auth_helper", previousSessionId: actor.session.id }
    });
    await r.audit.record({ actorType: "account", actorId: actor.accountId, action: "admin.staging.fresh_auth_session", result: "allowed", requestId, context: { previousSessionId: actor.session.id, newSessionId: session.id } });
    return jsonResponse({ ok: true, message: "Staging fresh-auth session created. Confirm elevation from this session." }, 201, noStore({ "Set-Cookie": sessionCookie(session.token, config, config.sessionTtlSeconds), "X-OFA-CSRF": session.csrfToken }));
  }

  if (path.startsWith("/api/v1/admin/players/by-username/") && request.method === "GET") {
    const required = await adminActor(request, env, config, "players.inspect");
    if (required.response) return required.response;
    const { actor, repos: r } = required;
    const username = decodeURIComponent(path.slice("/api/v1/admin/players/by-username/".length));
    const player = await r.admin.playerByUsername(username);
    await r.audit.record({ actorType: "account", actorId: actor.accountId, action: "admin.player.inspect", resourceType: "account", resourceId: player?.id || null, result: player ? "allowed" : "not_found", requestId, context: { lookup: "username" } });
    if (!player) return bodyError("player_not_found", "Player not found.", 404);
    const snapshot = await r.admin.playerSnapshot(player.id);
    const inventory = await r.meInventory.list(player.id);
    return jsonResponse({ ok: true, player: { ...snapshot, inventory } }, 200, noStore());
  }

  if (path === "/api/v1/admin/progression/definitions" && request.method === "GET") {
    const required = await adminActor(request, env, config, "progression.definitions.read");
    if (required.response) return required.response;
    const { actor, repos: r } = required;
    const definitions = await r.progressionDefinitions.list();
    await r.audit.record({ actorType: "account", actorId: actor.accountId, action: "admin.progression.definitions.read", result: "allowed", requestId, context: { count: definitions.length } });
    return jsonResponse({ ok: true, definitions }, 200, noStore());
  }

  if (path.startsWith("/api/v1/admin/progression/definitions/") && request.method === "GET") {
    const required = await adminActor(request, env, config, "progression.definitions.read");
    if (required.response) return required.response;
    const { actor, repos: r } = required;
    const eventKey = decodeURIComponent(path.slice("/api/v1/admin/progression/definitions/".length));
    const versions = await r.progressionDefinitions.byEventKey(eventKey);
    await r.audit.record({ actorType: "account", actorId: actor.accountId, action: "admin.progression.definition.read", resourceType: "authored_event", resourceId: eventKey, result: versions.length ? "allowed" : "not_found", requestId });
    if (!versions.length) return bodyError("progression_definition_not_found", "Progression definition not found.", 404);
    return jsonResponse({ ok: true, eventKey, versions }, 200, noStore());
  }

  if (path === "/api/v1/admin/progression/events" && request.method === "GET") {
    const required = await adminActor(request, env, config, "progression.players.read");
    if (required.response) return required.response;
    const { actor, repos: r } = required;
    const player = await r.admin.playerByUsername(url.searchParams.get("username") || "");
    if (!player) return bodyError("player_not_found", "Player not found.", 404);
    const events = await r.progression.eventsForAccount(player.id, url.searchParams.get("limit") || 50);
    await r.audit.record({ actorType: "account", actorId: actor.accountId, action: "admin.progression.events.read", resourceType: "account", resourceId: player.id, result: "allowed", requestId, context: { count: events.length } });
    return jsonResponse({ ok: true, player: { username: player.username_display }, events }, 200, noStore());
  }

  if (path.startsWith("/api/v1/admin/progression/events/") && request.method === "GET") {
    const required = await adminActor(request, env, config, "progression.players.read");
    if (required.response) return required.response;
    const { actor, repos: r } = required;
    const eventId = decodeURIComponent(path.slice("/api/v1/admin/progression/events/".length));
    const detail = await r.progression.eventDetail(eventId);
    await r.audit.record({ actorType: "account", actorId: actor.accountId, action: "admin.progression.event.read", resourceType: "progression_event", resourceId: eventId, result: detail ? "allowed" : "not_found", requestId });
    if (!detail) return bodyError("progression_event_not_found", "Progression event not found.", 404);
    return jsonResponse({ ok: true, detail }, 200, noStore());
  }

  if (path === "/api/v1/admin/progression/simulate" && request.method === "POST") {
    const required = await adminActor(request, env, config, "progression.simulate");
    if (required.response) return required.response;
    const { actor, repos: r } = required;
    const gated = await dangerousGate({ request, actor, r, confirm: "SIMULATE_PROGRESSION", operation: "progression.simulate", limit: 60 });
    if (gated instanceof Response) return gated;
    const player = await r.admin.playerByUsername(gated.body.username || "");
    if (!player) return bodyError("player_not_found", "Player not found.", 404);
    const eventType = String(gated.body.eventType || "");
    const sourceType = eventType.startsWith("phase6.staging.") ? "staging_admin" : "server";
    try {
      const simulation = await new ProgressionEngine(env.DB, { environment: config.envName }).simulate({
        eventType,
        sourceType,
        sourceSubject: `admin-simulation:${actor.accountId}:${player.id}`,
        accountId: player.id,
        idempotencyKey: `simulation-${requestId}`,
        payload: gated.body.payload || {},
        provenance: { source: "admin_simulation", actorId: actor.accountId },
        requestId
      });
      await r.audit.record({ actorType: "account", actorId: actor.accountId, action: "admin.progression.simulate", resourceType: "account", resourceId: player.id, result: "allowed", requestId, context: { eventType, eventCount: simulation.eventCount, effectCount: simulation.effectCount, committed: false } });
      return jsonResponse({ ok: true, simulation }, 200, noStore());
    } catch (error) {
      await r.audit.record({ actorType: "account", actorId: actor.accountId, action: "admin.progression.simulate", resourceType: "account", resourceId: player.id, result: "denied", requestId, context: { eventType, code: error.code || "simulation_failed" } });
      return progressionApiError(error);
    }
  }

  if (path === "/api/v1/admin/staging/progression/trigger" && request.method === "POST") {
    if (!isStagingAdminHelperEnabled(config)) return bodyError("not_found", "Not found.", 404);
    const required = await adminActor(request, env, config, "progression.staging.trigger");
    if (required.response) return required.response;
    const { actor, repos: r } = required;
    const gated = await dangerousGate({ request, actor, r, confirm: "TRIGGER_PROGRESSION_EVENT", operation: "progression.staging.trigger", limit: 200 });
    if (gated instanceof Response) return gated;
    const player = await r.admin.playerByUsername(gated.body.username || "");
    if (!player) return bodyError("player_not_found", "Player not found.", 404);
    const eventType = String(gated.body.eventType || "");
    if (!STAGING_PROGRESSION_EVENT_TYPES.has(eventType)) return bodyError("staging_event_not_allowed", "Staging progression event is not allowlisted.", 400);
    try {
      const result = await new ProgressionEngine(env.DB, { environment: config.envName }).ingest({
        eventType,
        sourceType: "staging_admin",
        sourceSubject: `${actor.accountId}:${player.id}`,
        accountId: player.id,
        idempotencyKey: gated.body.idempotencyKey || `staging-${requestId}`,
        payload: gated.body.payload || {},
        provenance: { source: "admin_staging_trigger", actorId: actor.accountId },
        requestId
      });
      await r.audit.record({ actorType: "account", actorId: actor.accountId, action: "admin.progression.staging_trigger", resourceType: "account", resourceId: player.id, result: "allowed", requestId, context: { eventType, duplicate: result.duplicate, rootEventId: result.rootEventId } });
      return jsonResponse({ ok: true, progression: result }, result.duplicate ? 200 : 201, noStore());
    } catch (error) {
      await r.audit.record({ actorType: "account", actorId: actor.accountId, action: "admin.progression.staging_trigger", resourceType: "account", resourceId: player.id, result: "denied", requestId, context: { eventType, code: error.code || "execution_failed" } });
      return progressionApiError(error);
    }
  }

  if (path.startsWith("/api/v1/admin/content/records/") && request.method === "GET") {
    const required = await adminActor(request, env, config, "admin.access");
    if (required.response) return required.response;
    const { actor, repos: r } = required;
    const slug = decodeURIComponent(path.slice("/api/v1/admin/content/records/".length));
    const record = await r.archive.findRecordBySlug(slug);
    if (!record) return bodyError("record_not_found", "Record not found.", 404);
    const protectedFields = await r.archive.protectedFields(record.id);
    await r.audit.record({ actorType: "account", actorId: actor.accountId, action: "admin.content.inspect", resourceType: "record", resourceId: record.id, result: "allowed", requestId, context: { slug } });
    return jsonResponse({ ok: true, record: { ...record, protectedFields } }, 200, noStore());
  }

  const playerMatch = path.match(/^\/api\/v1\/admin\/players\/([^/]+)\/(.+)$/);
  if (playerMatch) {
    const accountId = decodeURIComponent(playerMatch[1]);
    const action = playerMatch[2];
    const readRequired = await adminActor(request, env, config, action === "inventory-ledger" ? "players.inspect" : "players.mutate");
    if (readRequired.response) return readRequired.response;
    const { actor, repos: r } = readRequired;

    if (action === "inventory-ledger" && request.method === "GET") {
      await r.audit.record({ actorType: "account", actorId: actor.accountId, action: "admin.inventory.ledger.read", resourceType: "account", resourceId: accountId, result: "allowed", requestId });
      return jsonResponse({ ok: true, ledger: await r.admin.inventoryLedger(accountId, url.searchParams.get("limit") || 100) }, 200, noStore());
    }

    if (action === "discoveries/grant" && request.method === "POST") {
      const gated = await dangerousGate({ request, actor, r, confirm: "GRANT_DISCOVERY", operation: "discoveries.grant" });
      if (gated instanceof Response) return gated;
      await r.admin.grantDiscovery({ accountId, discoveryType: gated.body.discoveryType || "admin", discoveryKey: gated.body.discoveryKey || "", actorId: actor.accountId, reason: gated.body.reason || "" });
      await r.audit.record({ actorType: "account", actorId: actor.accountId, action: "admin.discovery.grant", resourceType: "account", resourceId: accountId, result: "allowed", requestId, context: { discoveryType: gated.body.discoveryType, discoveryKey: gated.body.discoveryKey, reason: gated.body.reason || "" } });
      return jsonResponse({ ok: true }, 201, noStore());
    }

    if (action === "discoveries/revoke" && request.method === "POST") {
      const gated = await dangerousGate({ request, actor, r, confirm: "REVOKE_DISCOVERY", operation: "discoveries.revoke" });
      if (gated instanceof Response) return gated;
      const changes = await r.admin.revokeDiscovery({ accountId, discoveryType: gated.body.discoveryType || "admin", discoveryKey: gated.body.discoveryKey || "" });
      await r.audit.record({ actorType: "account", actorId: actor.accountId, action: "admin.discovery.revoke", resourceType: "account", resourceId: accountId, result: "allowed", requestId, context: { changes, discoveryType: gated.body.discoveryType, discoveryKey: gated.body.discoveryKey, reason: gated.body.reason || "" } });
      return jsonResponse({ ok: true, revoked: changes }, 200, noStore());
    }

    if (action === "inventory/grant" && request.method === "POST") {
      const gated = await dangerousGate({ request, actor, r, confirm: "GRANT_INVENTORY", operation: "inventory.grant" });
      if (gated instanceof Response) return gated;
      if (!gated.body.itemKey) return bodyError("item_key_required", "Item key is required.", 400);
      if (gated.body.stackable !== false && Number(gated.body.quantity || 1) <= 0) return bodyError("invalid_quantity", "Quantity must be positive.", 400);
      const def = await r.admin.ensureItemDefinition({ itemKey: gated.body.itemKey, name: gated.body.name || gated.body.itemKey, stackable: gated.body.stackable !== false });
      const idempotencyKey = `admin:${actor.accountId}:grant:${accountId}:${gated.body.itemKey}:${gated.body.idempotencyKey || requestId}`;
      const result = gated.body.stackable === false
        ? await r.inventory.createInstance({ accountId, itemDefinitionId: def.id, provenance: { source: "admin", actorId: actor.accountId, reason: gated.body.reason || "" }, idempotencyKey })
        : await r.inventory.grantQuantity({ accountId, itemDefinitionId: def.id, quantity: Number(gated.body.quantity || 1), provenance: { source: "admin", actorId: actor.accountId, reason: gated.body.reason || "" }, idempotencyKey });
      await r.audit.record({ actorType: "account", actorId: actor.accountId, action: "admin.inventory.grant", resourceType: "account", resourceId: accountId, result: "allowed", requestId, context: { itemKey: gated.body.itemKey, quantity: gated.body.quantity || 1, stackable: gated.body.stackable !== false, reason: gated.body.reason || "" } });
      return jsonResponse({ ok: true, grant: result }, 201, noStore());
    }

    if (action === "inventory/revoke" && request.method === "POST") {
      const gated = await dangerousGate({ request, actor, r, confirm: "REVOKE_INVENTORY", operation: "inventory.revoke" });
      if (gated instanceof Response) return gated;
      if (!gated.body.itemInstanceId && !gated.body.itemKey) return bodyError("inventory_target_required", "Item key or instance ID is required.", 400);
      if (!gated.body.itemInstanceId && Number(gated.body.quantity || 1) <= 0) return bodyError("invalid_quantity", "Quantity must be positive.", 400);
      const idempotencyKey = `admin:${actor.accountId}:revoke:${accountId}:${gated.body.itemInstanceId || gated.body.itemKey}:${gated.body.idempotencyKey || requestId}`;
      let result;
      try {
        if (gated.body.itemInstanceId) {
          result = await r.admin.revokeInstanceCustody({ accountId, itemInstanceId: gated.body.itemInstanceId, actorId: actor.accountId, reason: gated.body.reason || "", idempotencyKey });
        } else {
          const def = await r.admin.findItemDefinition(gated.body.itemKey);
          if (!def) return bodyError("item_not_found", "Item definition not found.", 404);
          result = await r.admin.revokeQuantity({ accountId, itemDefinitionId: def.id, quantity: Number(gated.body.quantity || 1), actorId: actor.accountId, reason: gated.body.reason || "", idempotencyKey });
        }
      } catch (error) {
        if (error.message === "invalid_inventory_quantity") return bodyError("invalid_inventory_quantity", "Inventory quantity cannot go below zero.", 400);
        if (error.message === "item_instance_not_found") return bodyError("item_instance_not_found", "Item instance not found for that account.", 404);
        throw error;
      }
      await r.audit.record({ actorType: "account", actorId: actor.accountId, action: "admin.inventory.revoke", resourceType: "account", resourceId: accountId, result: "allowed", requestId, context: { itemKey: gated.body.itemKey || null, itemInstanceId: gated.body.itemInstanceId || null, quantity: gated.body.quantity || null, reason: gated.body.reason || "" } });
      return jsonResponse({ ok: true, revoke: result }, 200, noStore());
    }

    if (action === "fictional-clearance/set" && request.method === "POST") {
      const gated = await dangerousGate({ request, actor, r, confirm: "SET_CLEARANCE", operation: "fictional-clearance.set" });
      if (gated instanceof Response) return gated;
      const before = await r.admin.playerById(accountId);
      await r.admin.setClearance({ accountId, clearanceState: gated.body.clearanceState || {} });
      await r.audit.record({ actorType: "account", actorId: actor.accountId, action: "admin.fictional_clearance.set", resourceType: "account", resourceId: accountId, result: "allowed", requestId, context: { before: before?.clearance_state_json || "{}", after: gated.body.clearanceState || {}, reason: gated.body.reason || "" } });
      return jsonResponse({ ok: true }, 200, noStore());
    }

    if (action === "sessions/revoke" && request.method === "POST") {
      const gated = await dangerousGate({ request, actor, r, confirm: "REVOKE_ACCOUNT_SESSIONS", operation: "sessions.revoke", limit: 10 });
      if (gated instanceof Response) return gated;
      const revoked = await r.admin.revokeAccountSessions({ accountId, reason: "admin_account_revoke", exceptSessionId: accountId === actor.accountId ? actor.session.id : null });
      await r.audit.record({ actorType: "account", actorId: actor.accountId, action: "admin.sessions.revoke_account", resourceType: "account", resourceId: accountId, result: "allowed", requestId, context: { revoked, ownSessionPreserved: accountId === actor.accountId } });
      return jsonResponse({ ok: true, revoked }, 200, noStore());
    }
  }

  if (path === "/api/v1/admin/operations/modes" && request.method === "GET") {
    const required = await adminActor(request, env, config, "operations.manage");
    if (required.response) return required.response;
    await required.repos.audit.record({ actorType: "account", actorId: required.actor.accountId, action: "admin.operations.modes.read", result: "allowed", requestId });
    return jsonResponse({ ok: true, modes: await required.repos.modes.all() }, 200, noStore());
  }

  if (path === "/api/v1/admin/operations/modes/set" && request.method === "POST") {
    const required = await adminActor(request, env, config, "operations.manage");
    if (required.response) return required.response;
    const { actor, repos: r } = required;
    const gated = await dangerousGate({ request, actor, r, confirm: "SET_OPERATIONAL_MODE", operation: "operations.modes.set", limit: 10 });
    if (gated instanceof Response) return gated;
    if (!["registrations_disabled", "auth_initiation_disabled", "player_mutations_disabled", "authored_events_disabled"].includes(gated.body.modeKey)) {
      return bodyError("unknown_operational_mode", "Operational mode is not supported.", 400);
    }
    await r.modes.set(gated.body.modeKey, !!gated.body.enabled, { actorId: actor.accountId, reason: gated.body.reason || "" });
    await r.audit.record({ actorType: "account", actorId: actor.accountId, action: "admin.operations.mode.set", resourceType: "operational_mode", resourceId: gated.body.modeKey, result: "allowed", requestId, context: { enabled: !!gated.body.enabled, reason: gated.body.reason || "" } });
    return jsonResponse({ ok: true }, 200, noStore());
  }

  if (path === "/api/v1/admin/sessions/revoke-all" && request.method === "POST") {
    const required = await adminActor(request, env, config, "sessions.revoke");
    if (required.response) return required.response;
    const { actor, repos: r } = required;
    const gated = await dangerousGate({ request, actor, r, confirm: "REVOKE_ALL_SESSIONS", operation: "sessions.revoke_all", limit: 3 });
    if (gated instanceof Response) return gated;
    const revoked = await r.admin.revokeGlobalSessions({ reason: "admin_global_revoke", exceptSessionId: actor.session.id });
    await r.audit.record({ actorType: "account", actorId: actor.accountId, action: "admin.sessions.revoke_global", result: "allowed", requestId, context: { revoked, initiatingSessionPreserved: true, reason: gated.body.reason || "" } });
    return jsonResponse({ ok: true, revoked, initiatingSessionPreserved: true }, 200, noStore());
  }

  if (path === "/api/v1/admin/content/preview" && request.method === "POST") {
    const required = await adminActor(request, env, config, "admin.access");
    if (required.response) return required.response;
    const { actor, repos: r } = required;
    if (!(await requireCsrf(request, actor, r))) return bodyError("csrf_required", "CSRF validation failed.", 403);
    const body = await readJson(request);
    const record = await r.archive.findRecordBySlug(body.slug || "");
    if (!record) return bodyError("record_not_found", "Record not found.", 404);
    let previewActor = buildActorContext();
    if (body.as === "authenticated") previewActor = buildActorContext({ accountId: "preview" });
    if (body.as === "player" && body.username) {
      const player = await r.admin.playerByUsername(body.username);
      previewActor = buildActorContext({
        accountId: player?.id || null,
        discoveries: await r.archive.discoveries(player?.id),
        archiveIdentity: await r.archive.archiveIdentity(player?.id)
      });
    }
    const filtered = await filterRecord(record, previewActor, r.archive, { detail: true });
    await r.audit.record({ actorType: "account", actorId: actor.accountId, action: "admin.content.preview", resourceType: "record", resourceId: record.id, result: "allowed", requestId, context: { slug: body.slug, as: body.as || "anonymous" } });
    return jsonResponse({ ok: true, preview: filtered.record || filtered.shape?.body }, 200, noStore());
  }

  return null;
}

const STAGING_PROGRESSION_EVENT_TYPES = new Set([
  "phase6.staging.observation",
  "phase6.staging.chain.1",
  "phase6.staging.rollback"
]);

function progressionApiError(error) {
  const code = error.code || "progression_execution_failed";
  if (code === "authored_events_disabled") return bodyError(code, "Authored event execution is disabled.", 503);
  if (code === "idempotency_conflict") return bodyError(code, "Idempotency key conflicts with an existing event.", 409);
  if (["unknown_event_type", "event_source_forbidden", "event_environment_forbidden", "invalid_event_payload", "unknown_event_payload_field", "missing_event_payload_field", "invalid_event_payload_field", "idempotency_key_invalid"].includes(code)) {
    return bodyError(code, "Progression event request is invalid.", 400);
  }
  return bodyError(code, "Progression execution failed atomically.", 422);
}

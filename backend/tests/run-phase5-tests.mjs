import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { applyMigrations } from "../src/db/migrations.js";
import { SQLiteD1Adapter } from "../src/db/sqlite-adapter.js";
import { seedPhase4Staging } from "../src/content/seed-phase4-staging.js";
import { AuthRepository } from "../src/repositories/auth-repository.js";
import { createOFAStagingServer } from "../src/server/server.js";

const testDir = dirname(fileURLToPath(import.meta.url));
const backendDir = dirname(testDir);
const tempDir = mkdtempSync(join(tmpdir(), "ofa-phase5-"));
const staticRoot = mkdtempSync(join(tmpdir(), "ofa-phase5-static-"));
const sqlitePath = join(tempDir, "phase5.sqlite");
const fieldKey = Buffer.alloc(32, 11).toString("base64");
const logs = [];
const logger = {
  debug: (message, detail) => logs.push({ level: "debug", message, detail }),
  info: (message, detail) => logs.push({ level: "info", message, detail }),
  warn: (message, detail) => logs.push({ level: "warn", message, detail }),
  error: (message, detail) => logs.push({ level: "error", message, detail })
};

const db = new SQLiteD1Adapter(sqlitePath);
await applyMigrations(db, join(backendDir, "migrations-server"));
await seedPhase4Staging(db);
db.close();

const config = {
  envName: "staging",
  host: "127.0.0.1",
  port: 0,
  staticRoot,
  logLevel: "debug",
  sqlitePath,
  sessionPepper: "phase5-session-pepper",
  identityPepper: "phase5-identity-pepper",
  fieldEncryptionKey: fieldKey,
  fieldEncryptionKeyId: "test:v1",
  sessionTtlSeconds: 3600,
  cookieSecure: false,
  localEmailLinksEnabled: true,
  workerEnv: { OFA_ALLOWED_ORIGINS: "" }
};

const runtime = createOFAStagingServer({ config, logger });
runtime.server.listen(0, "127.0.0.1");
await once(runtime.server, "listening");
const base = `http://127.0.0.1:${runtime.server.address().port}`;

async function api(path, options = {}) {
  const res = await fetch(`${base}${path}`, {
    method: options.method || "GET",
    headers: {
      "Content-Type": "application/json",
      ...(options.cookie ? { Cookie: options.cookie } : {}),
      ...(options.csrf ? { "X-OFA-CSRF": options.csrf } : {}),
      ...(options.headers || {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const body = await res.json().catch(() => ({}));
  return { res, body };
}

async function signIn(username, email) {
  const registered = await api("/api/v1/auth/register", { method: "POST", body: { username, email } });
  assert.equal(registered.res.status, 201);
  return await emailSignIn(username, email);
}

async function emailSignIn(username, email) {
  await api("/api/v1/auth/email/start", { method: "POST", body: { email } });
  const tokenLog = logs.filter((entry) => entry.message === "local_staging_email_link" && entry.detail?.username === username).at(-1);
  assert.equal(!!tokenLog?.detail?.token, true);
  const completed = await api("/api/v1/auth/email/complete", { method: "POST", body: { token: tokenLog.detail.token } });
  assert.equal(completed.res.status, 200);
  const cookie = completed.res.headers.get("set-cookie").split(";")[0];
  const me = await api("/api/v1/me", { cookie });
  assert.equal(me.res.status, 200);
  return {
    username,
    email,
    cookie,
    csrf: me.res.headers.get("x-ofa-csrf"),
    accountId: await accountId(username)
  };
}

async function accountId(username) {
  const checkDb = new SQLiteD1Adapter(sqlitePath);
  try {
    const row = await checkDb.prepare("SELECT account_id FROM account_profiles WHERE username_normalized = ?").bind(username.trim().toLowerCase()).first();
    return row?.account_id || "";
  } finally {
    checkDb.close();
  }
}

async function grantRole(accountIdValue, roleKey) {
  const roleDb = new SQLiteD1Adapter(sqlitePath);
  try {
    const auth = new AuthRepository(roleDb, { sessionPepper: "phase5-session-pepper" });
    await auth.grantRole(accountIdValue, roleKey, "global", "phase5-test");
  } finally {
    roleDb.close();
  }
}

async function elevate(actor) {
  const freshSession = await api("/api/v1/admin/staging/fresh-auth-session", { method: "POST", cookie: actor.cookie, csrf: actor.csrf, body: {} });
  assert.equal(freshSession.res.status, 201);
  const fresh = {
    ...actor,
    cookie: freshSession.res.headers.get("set-cookie").split(";")[0],
    csrf: freshSession.res.headers.get("x-ofa-csrf")
  };
  assert.notEqual(fresh.cookie, actor.cookie);
  assert.notEqual(fresh.csrf, actor.csrf);
  const confirmed = await api("/api/v1/admin/elevation/confirm", { method: "POST", cookie: fresh.cookie, csrf: fresh.csrf, body: { confirm: "ELEVATE" } });
  assert.equal(confirmed.res.status, 200);
  return fresh;
}

try {
  const ordinary = await signIn("Phase5User", "phase5-user@example.invalid");
  const tabAcsrf = ordinary.csrf;
  const tabBMe = await api("/api/v1/me", { cookie: ordinary.cookie });
  assert.equal(tabBMe.res.status, 200);
  const tabBcsrf = tabBMe.res.headers.get("x-ofa-csrf");
  assert.equal(!!tabBcsrf, true);
  assert.equal(tabBcsrf, tabAcsrf);
  const tabAStillValid = await api("/api/v1/me/discoveries", { method: "POST", cookie: ordinary.cookie, csrf: tabAcsrf, body: { discoveryType: "flag", discoveryKey: "phase5-tab-a-still-valid" } });
  assert.equal(tabAStillValid.res.status, 201);
  const tabBValid = await api("/api/v1/me/discoveries", { method: "POST", cookie: ordinary.cookie, csrf: tabBcsrf, body: { discoveryType: "flag", discoveryKey: "phase5-tab-b-valid" } });
  assert.equal(tabBValid.res.status, 201);
  const ordinarySecondSession = await emailSignIn("Phase5User", "phase5-user@example.invalid");
  assert.notEqual(ordinarySecondSession.cookie, ordinary.cookie);
  assert.notEqual(ordinarySecondSession.csrf, ordinary.csrf);
  const crossSessionCsrf = await api("/api/v1/me/discoveries", { method: "POST", cookie: ordinarySecondSession.cookie, csrf: ordinary.csrf, body: { discoveryType: "flag", discoveryKey: "phase5-cross-session-blocked" } });
  assert.equal(crossSessionCsrf.res.status, 403);
  const owner = await signIn("Phase5Owner", "phase5-owner@example.invalid");
  await grantRole(owner.accountId, "owner");
  const contentAdmin = await signIn("Phase5Content", "phase5-content@example.invalid");
  await grantRole(contentAdmin.accountId, "content_admin");
  const systemAdmin = await signIn("Phase5System", "phase5-system@example.invalid");
  await grantRole(systemAdmin.accountId, "system_admin");
  const developerReadonly = await signIn("Phase5Developer", "phase5-developer@example.invalid");
  await grantRole(developerReadonly.accountId, "developer_readonly");

  const ordinaryMe = await api("/api/v1/me", { cookie: owner.cookie });
  assert.equal(JSON.stringify(ordinaryMe.body).includes("owner"), false);
  assert.equal(ordinaryMe.body.account.id, undefined);

  assert.equal((await fetch(`${base}/admin/control-center.html`, { headers: { Cookie: ordinary.cookie } })).status, 404);
  assert.equal((await fetch(`${base}/admin/control-center.html`, { headers: { Cookie: owner.cookie } })).status, 200);
  assert.equal((await api("/api/v1/admin/me", { cookie: ordinary.cookie })).res.status, 403);
  assert.equal((await api("/api/v1/admin/me", { headers: { "X-OFA-Role": "owner" } })).res.status, 401);
  assert.equal((await api("/api/v1/admin/players/by-username/Phase5User", { cookie: contentAdmin.cookie })).res.status, 403);
  assert.equal((await api("/api/v1/admin/players/by-username/Phase5User", { cookie: developerReadonly.cookie })).res.status, 403);
  assert.equal((await api("/api/v1/admin/players/by-username/Phase5User", { cookie: systemAdmin.cookie })).res.status, 200);
  const systemAdminMe = await api("/api/v1/admin/me", { cookie: systemAdmin.cookie });
  systemAdmin.csrf = systemAdminMe.res.headers.get("x-ofa-csrf");
  assert.equal((await api("/api/v1/admin/staging/fresh-auth-session", { method: "POST", body: {} })).res.status, 401);
  assert.equal((await api("/api/v1/admin/staging/fresh-auth-session", { method: "POST", cookie: ordinary.cookie, csrf: ordinary.csrf, body: {} })).res.status, 403);
  const systemAdminFresh = await api("/api/v1/admin/staging/fresh-auth-session", { method: "POST", cookie: systemAdmin.cookie, csrf: systemAdmin.csrf, body: {} });
  assert.equal(systemAdminFresh.res.status, 201);

  const clearDb = new SQLiteD1Adapter(sqlitePath);
  try {
    await clearDb.prepare("UPDATE archive_identities SET clearance_state_json = '{\"owner\":true,\"clearances\":[\"owner\"]}' WHERE account_id = ?").bind(ordinary.accountId).run();
  } finally {
    clearDb.close();
  }
  assert.equal((await api("/api/v1/admin/me", { cookie: ordinary.cookie })).res.status, 403);
  assert.equal((await api("/api/v1/admin/staging/fresh-auth-session", { method: "POST", cookie: ordinary.cookie, csrf: ordinary.csrf, body: {} })).res.status, 403);

  const ownerAdmin = await api("/api/v1/admin/me", { cookie: owner.cookie });
  assert.equal(ownerAdmin.res.status, 200);
  assert.equal(ownerAdmin.body.admin.roles.includes("owner"), true);
  owner.csrf = ownerAdmin.res.headers.get("x-ofa-csrf");

  const productionConfig = { ...config, envName: "production", localEmailLinksEnabled: false };
  const productionRuntime = createOFAStagingServer({ config: productionConfig, logger });
  productionRuntime.server.listen(0, "127.0.0.1");
  await once(productionRuntime.server, "listening");
  try {
    const prodBase = `http://127.0.0.1:${productionRuntime.server.address().port}`;
    const prodHelper = await fetch(`${prodBase}/api/v1/admin/staging/fresh-auth-session`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: owner.cookie, "X-OFA-CSRF": owner.csrf },
      body: JSON.stringify({})
    });
    assert.equal(prodHelper.status, 404);
    const prodControlCenter = await fetch(`${prodBase}/admin/control-center.html`, { headers: { Cookie: owner.cookie } });
    assert.equal(prodControlCenter.status, 200);
    assert.equal((await prodControlCenter.text()).includes("staging fresh-auth helper"), false);
  } finally {
    productionRuntime.server.close();
  }

  const player = await api("/api/v1/admin/players/by-username/Phase5User", { cookie: owner.cookie });
  assert.equal(player.res.status, 200);
  assert.equal(player.body.player.account.id, ordinary.accountId);
  assert.equal(player.body.player.inventory.balances.length, 0);

  const staleDb = new SQLiteD1Adapter(sqlitePath);
  try {
    await staleDb.prepare("UPDATE sessions SET issued_at = '2000-01-01T00:00:00.000Z' WHERE account_id = ?").bind(owner.accountId).run();
  } finally {
    staleDb.close();
  }
  const productionConfirmConfig = { ...config, envName: "production", localEmailLinksEnabled: false };
  const productionConfirmRuntime = createOFAStagingServer({ config: productionConfirmConfig, logger });
  productionConfirmRuntime.server.listen(0, "127.0.0.1");
  await once(productionConfirmRuntime.server, "listening");
  try {
    const prodBase = `http://127.0.0.1:${productionConfirmRuntime.server.address().port}`;
    const prodStaleConfirm = await fetch(`${prodBase}/api/v1/admin/elevation/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: owner.cookie, "X-OFA-CSRF": owner.csrf },
      body: JSON.stringify({ confirm: "ELEVATE" })
    });
    assert.equal(prodStaleConfirm.status, 403);
  } finally {
    productionConfirmRuntime.server.close();
  }
  const staleElevation = await api("/api/v1/admin/elevation/confirm", { method: "POST", cookie: owner.cookie, csrf: owner.csrf, body: { confirm: "ELEVATE" } });
  assert.equal(staleElevation.res.status, 403);

  const elevatedOwner = await elevate(owner);
  const elevatedMe = await api("/api/v1/admin/me", { cookie: elevatedOwner.cookie });
  assert.equal(elevatedMe.body.admin.elevated, true);
  elevatedOwner.csrf = elevatedMe.res.headers.get("x-ofa-csrf");
  const normalMeDuringElevation = await api("/api/v1/me", { cookie: elevatedOwner.cookie });
  assert.equal(JSON.stringify(normalMeDuringElevation.body).includes("elevated"), false);
  elevatedOwner.csrf = normalMeDuringElevation.res.headers.get("x-ofa-csrf");

  const noElevationGrant = await api(`/api/v1/admin/players/${ordinary.accountId}/discoveries/grant`, { method: "POST", cookie: owner.cookie, csrf: owner.csrf, body: { confirm: "GRANT_DISCOVERY", discoveryType: "admin", discoveryKey: "phase5.blocked" } });
  assert.equal(noElevationGrant.res.status, 403);
  const badGlobalNoCsrf = await api("/api/v1/admin/sessions/revoke-all", { method: "POST", cookie: elevatedOwner.cookie, body: { confirm: "REVOKE_ALL_SESSIONS", reason: "test" } });
  assert.equal(badGlobalNoCsrf.res.status, 403);
  const badGlobalConfirm = await api("/api/v1/admin/sessions/revoke-all", { method: "POST", cookie: elevatedOwner.cookie, csrf: elevatedOwner.csrf, body: { confirm: "NOPE", reason: "test" } });
  assert.equal(badGlobalConfirm.res.status, 400);

  const expireDb = new SQLiteD1Adapter(sqlitePath);
  try {
    await expireDb.prepare("UPDATE admin_elevations SET expires_at = '2000-01-01T00:00:00.000Z' WHERE session_id IN (SELECT id FROM sessions WHERE account_id = ?)").bind(elevatedOwner.accountId).run();
  } finally {
    expireDb.close();
  }
  const expiredGrant = await api(`/api/v1/admin/players/${ordinary.accountId}/discoveries/grant`, { method: "POST", cookie: elevatedOwner.cookie, csrf: elevatedOwner.csrf, body: { confirm: "GRANT_DISCOVERY", discoveryType: "admin", discoveryKey: "phase5.expired" } });
  assert.equal(expiredGrant.res.status, 403);
  const reElevatedOwner = await elevate(owner);
  elevatedOwner.cookie = reElevatedOwner.cookie;
  elevatedOwner.csrf = reElevatedOwner.csrf;

  const grantDiscovery = await api(`/api/v1/admin/players/${ordinary.accountId}/discoveries/grant`, { method: "POST", cookie: elevatedOwner.cookie, csrf: elevatedOwner.csrf, body: { confirm: "GRANT_DISCOVERY", discoveryType: "admin", discoveryKey: "phase5.granted", reason: "test" } });
  assert.equal(grantDiscovery.res.status, 201);
  const revokeDiscovery = await api(`/api/v1/admin/players/${ordinary.accountId}/discoveries/revoke`, { method: "POST", cookie: elevatedOwner.cookie, csrf: elevatedOwner.csrf, body: { confirm: "REVOKE_DISCOVERY", discoveryType: "admin", discoveryKey: "phase5.granted", reason: "test" } });
  assert.equal(revokeDiscovery.res.status, 200);

  const grantStack = await api(`/api/v1/admin/players/${ordinary.accountId}/inventory/grant`, { method: "POST", cookie: elevatedOwner.cookie, csrf: elevatedOwner.csrf, body: { confirm: "GRANT_INVENTORY", itemKey: "phase5_stack", name: "Phase 5 Stack", quantity: 3, reason: "test" } });
  assert.equal(grantStack.res.status, 201);
  const revokeStack = await api(`/api/v1/admin/players/${ordinary.accountId}/inventory/revoke`, { method: "POST", cookie: elevatedOwner.cookie, csrf: elevatedOwner.csrf, body: { confirm: "REVOKE_INVENTORY", itemKey: "phase5_stack", quantity: 2, reason: "test" } });
  assert.equal(revokeStack.res.status, 200);
  assert.equal(revokeStack.body.revoke.after, 1);
  const overRevoke = await api(`/api/v1/admin/players/${ordinary.accountId}/inventory/revoke`, { method: "POST", cookie: elevatedOwner.cookie, csrf: elevatedOwner.csrf, body: { confirm: "REVOKE_INVENTORY", itemKey: "phase5_stack", quantity: 2, reason: "test" } });
  assert.equal(overRevoke.res.status, 400);
  assert.equal(overRevoke.body.error.code, "invalid_inventory_quantity");

  const grantInstance = await api(`/api/v1/admin/players/${ordinary.accountId}/inventory/grant`, { method: "POST", cookie: elevatedOwner.cookie, csrf: elevatedOwner.csrf, body: { confirm: "GRANT_INVENTORY", itemKey: "phase5_instance", name: "Phase 5 Instance", stackable: false, reason: "test" } });
  assert.equal(grantInstance.res.status, 201);
  const instanceId = grantInstance.body.grant.id;
  const revokeInstance = await api(`/api/v1/admin/players/${ordinary.accountId}/inventory/revoke`, { method: "POST", cookie: elevatedOwner.cookie, csrf: elevatedOwner.csrf, body: { confirm: "REVOKE_INVENTORY", itemInstanceId: instanceId, reason: "test" } });
  assert.equal(revokeInstance.res.status, 200);
  const ledger = await api(`/api/v1/admin/players/${ordinary.accountId}/inventory-ledger`, { cookie: elevatedOwner.cookie });
  assert.equal(ledger.body.ledger.some((entry) => entry.operation === "admin_revoke_quantity" && entry.deltaQuantity === -2), true);
  assert.equal(ledger.body.ledger.some((entry) => entry.operation === "admin_revoke_instance" && entry.itemInstanceId === instanceId), true);

  const clearance = await api(`/api/v1/admin/players/${ordinary.accountId}/fictional-clearance/set`, { method: "POST", cookie: elevatedOwner.cookie, csrf: elevatedOwner.csrf, body: { confirm: "SET_CLEARANCE", clearanceState: { clearances: ["alpha"] }, reason: "test" } });
  assert.equal(clearance.res.status, 200);

  const preview = await api("/api/v1/admin/content/preview", { method: "POST", cookie: elevatedOwner.cookie, csrf: elevatedOwner.csrf, body: { slug: "phase4-signal-001", as: "player", username: "Phase5User" } });
  assert.equal(preview.res.status, 200);
  const canonical = await api("/api/v1/admin/content/records/phase4-signal-001", { cookie: elevatedOwner.cookie });
  assert.equal(canonical.res.status, 200);
  assert.equal(canonical.body.record.protectedFields.transcript, "WE WERE NEVER ONLY RECEIVING.");

  const disableRegistrations = await api("/api/v1/admin/operations/modes/set", { method: "POST", cookie: elevatedOwner.cookie, csrf: elevatedOwner.csrf, body: { confirm: "SET_OPERATIONAL_MODE", modeKey: "registrations_disabled", enabled: true, reason: "test" } });
  assert.equal(disableRegistrations.res.status, 200);
  assert.equal((await api("/api/v1/auth/register", { method: "POST", body: { username: "BlockedReg", email: "blocked-reg@example.invalid" } })).res.status, 503);
  await api("/api/v1/admin/operations/modes/set", { method: "POST", cookie: elevatedOwner.cookie, csrf: elevatedOwner.csrf, body: { confirm: "SET_OPERATIONAL_MODE", modeKey: "registrations_disabled", enabled: false, reason: "test" } });
  await api("/api/v1/admin/operations/modes/set", { method: "POST", cookie: elevatedOwner.cookie, csrf: elevatedOwner.csrf, body: { confirm: "SET_OPERATIONAL_MODE", modeKey: "auth_initiation_disabled", enabled: true, reason: "test" } });
  assert.equal((await api("/api/v1/auth/email/start", { method: "POST", body: { email: "phase5-user@example.invalid" } })).res.status, 503);
  await api("/api/v1/admin/operations/modes/set", { method: "POST", cookie: elevatedOwner.cookie, csrf: elevatedOwner.csrf, body: { confirm: "SET_OPERATIONAL_MODE", modeKey: "auth_initiation_disabled", enabled: false, reason: "test" } });
  await api("/api/v1/admin/operations/modes/set", { method: "POST", cookie: elevatedOwner.cookie, csrf: elevatedOwner.csrf, body: { confirm: "SET_OPERATIONAL_MODE", modeKey: "player_mutations_disabled", enabled: true, reason: "test" } });
  assert.equal((await api("/api/v1/me/discoveries", { method: "POST", cookie: ordinary.cookie, csrf: ordinary.csrf, body: { discoveryType: "staging", discoveryKey: "blocked" } })).res.status, 503);
  await api("/api/v1/admin/operations/modes/set", { method: "POST", cookie: elevatedOwner.cookie, csrf: elevatedOwner.csrf, body: { confirm: "SET_OPERATIONAL_MODE", modeKey: "player_mutations_disabled", enabled: false, reason: "test" } });

  const victim = await signIn("Phase5Victim", "phase5-victim@example.invalid");
  const revokeOne = await api(`/api/v1/admin/players/${victim.accountId}/sessions/revoke`, { method: "POST", cookie: elevatedOwner.cookie, csrf: elevatedOwner.csrf, body: { confirm: "REVOKE_ACCOUNT_SESSIONS", reason: "test" } });
  assert.equal(revokeOne.res.status, 200);
  assert.equal((await api("/api/v1/me", { cookie: victim.cookie })).res.status, 401);
  const revokedMutation = await api("/api/v1/me/discoveries", { method: "POST", cookie: victim.cookie, csrf: victim.csrf, body: { discoveryType: "flag", discoveryKey: "phase5-after-revoke" } });
  assert.equal(revokedMutation.res.status, 401);

  const victimTwo = await signIn("Phase5VictimTwo", "phase5-victim-two@example.invalid");
  const globalRevoke = await api("/api/v1/admin/sessions/revoke-all", { method: "POST", cookie: elevatedOwner.cookie, csrf: elevatedOwner.csrf, body: { confirm: "REVOKE_ALL_SESSIONS", reason: "test" } });
  assert.equal(globalRevoke.res.status, 200);
  assert.equal(globalRevoke.body.initiatingSessionPreserved, true);
  assert.equal((await api("/api/v1/me", { cookie: victimTwo.cookie })).res.status, 401);
  assert.equal((await api("/api/v1/admin/me", { cookie: elevatedOwner.cookie })).res.status, 200);

  let strictAuthRate;
  for (let i = 0; i < 8; i += 1) strictAuthRate = await api("/api/v1/auth/email/start", { method: "POST", body: { email: elevatedOwner.email } });
  assert.equal(strictAuthRate.res.status, 429);

  const auditDb = new SQLiteD1Adapter(sqlitePath);
  try {
    const audits = await auditDb.prepare("SELECT action, context_json FROM audit_events").all();
    const auditText = JSON.stringify(audits.results);
    assert.equal(auditText.includes("admin.discovery.grant"), true);
    assert.equal(auditText.includes("admin.inventory.revoke"), true);
    assert.equal(auditText.includes("admin.staging.fresh_auth_session"), true);
    assert.equal(auditText.includes("admin.sessions.revoke_global"), true);
    assert.equal(auditText.includes("local_staging_email_link"), false);
  } finally {
    auditDb.close();
  }

  console.log("phase 5 admin control center tests passed");
} finally {
  runtime.server.close();
}

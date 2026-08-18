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
const tempDir = mkdtempSync(join(tmpdir(), "ofa-phase4-"));
const staticRoot = mkdtempSync(join(tmpdir(), "ofa-phase4-static-"));
const sqlitePath = join(tempDir, "phase4.sqlite");
const fieldKey = Buffer.alloc(32, 9).toString("base64");
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
await seedPhase4Staging(db);
const seedMarkers = await db.prepare("SELECT COUNT(*) AS count FROM phase4_staging_seed_markers").first();
assert.equal(seedMarkers.count, 1);
db.close();

const config = {
  envName: "staging",
  host: "127.0.0.1",
  port: 0,
  staticRoot,
  logLevel: "debug",
  sqlitePath,
  sessionPepper: "phase4-session-pepper",
  identityPepper: "phase4-identity-pepper",
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
      ...(options.csrf ? { "X-OFA-CSRF": options.csrf } : {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const body = await res.json().catch(() => ({}));
  return { res, body };
}

async function signIn(username = "Phase4User", email = "phase4@example.invalid") {
  const registered = await api("/api/v1/auth/register", { method: "POST", body: { username, email } });
  assert.equal(registered.res.status, 201);
  await api("/api/v1/auth/email/start", { method: "POST", body: { email } });
  const tokenLog = logs.filter((entry) => entry.message === "local_staging_email_link" && entry.detail?.username === username).at(-1);
  assert.equal(!!tokenLog?.detail?.token, true);
  const completed = await api("/api/v1/auth/email/complete", { method: "POST", body: { token: tokenLog.detail.token } });
  assert.equal(completed.res.status, 200);
  return {
    cookie: completed.res.headers.get("set-cookie").split(";")[0],
    csrf: completed.res.headers.get("x-ofa-csrf")
  };
}

async function accountIdForUsername(username) {
  const checkDb = new SQLiteD1Adapter(sqlitePath);
  try {
    const row = await checkDb.prepare(`
      SELECT account_id
      FROM account_profiles
      WHERE username_normalized = ?
      LIMIT 1
    `).bind(username.trim().toLowerCase()).first();
    return row?.account_id || "";
  } finally {
    checkDb.close();
  }
}

try {
  const anonymousList = await api("/api/v1/archive/records");
  assert.equal(anonymousList.res.status, 200);
  assert.equal(anonymousList.body.records.some((record) => record.slug === "phase4-signal-001"), true);
  assert.equal(JSON.stringify(anonymousList.body).includes("WE WERE NEVER ONLY RECEIVING"), false);
  assert.equal(JSON.stringify(anonymousList.body).includes("This summary must not leak"), false);

  const anonymousSignal = await api("/api/v1/archive/records/phase4-signal-001");
  assert.equal(anonymousSignal.res.status, 200);
  assert.equal(anonymousSignal.body.record.slug, "phase4-signal-001");
  assert.equal(anonymousSignal.body.record.fields.body, "[AUTHENTICATED SESSION REQUIRED]");
  assert.equal(anonymousSignal.body.record.fields.transcript, "[TRANSCRIPT WITHHELD]");
  assert.equal(JSON.stringify(anonymousSignal.body).includes("WE WERE NEVER ONLY RECEIVING"), false);
  assert.equal(JSON.stringify(anonymousSignal.body).includes("operatorNote"), true);
  assert.equal(JSON.stringify(anonymousSignal.body).includes("Archive dislikes"), false);

  const anonymousCase = await api("/api/v1/archive/records/phase4-case-echo");
  assert.equal(anonymousCase.res.status, 403);
  assert.equal(anonymousCase.body.error.code, "restricted");
  assert.equal(JSON.stringify(anonymousCase.body).includes("Authenticated case body"), false);

  const withheld = await api("/api/v1/archive/records/phase4-withheld-null");
  assert.equal(withheld.res.status, 404);
  assert.equal(JSON.stringify(withheld.body).includes("This body must not leak"), false);

  const anonymousRelationships = await api("/api/v1/archive/relationships");
  assert.equal(anonymousRelationships.res.status, 200);
  assert.deepEqual(anonymousRelationships.body.relationships, []);

  const stagingPage = await fetch(`${base}/staging/archive-test.html`);
  assert.equal(stagingPage.status, 200);
  const accountPage = await fetch(`${base}/staging/account-test.html`);
  assert.equal(accountPage.status, 200);
  const accountPageText = await accountPage.text();
  for (const discoveryKey of ["phase4.signal001.transcript", "phase4.caseecho.personnel", "phase4.relationship.echo", "phase4.withheld.null"]) {
    assert.equal(accountPageText.includes(`grantPhase4Discovery('${discoveryKey}')`), true);
    assert.equal(accountPageText.includes(discoveryKey), true);
  }
  assert.equal(accountPageText.includes("discoveryKey.value"), false);
  assert.equal(accountPageText.includes('discoveryType:"phase4_staging"'), true);
  assert.equal(accountPageText.includes('discoveryKey:"phase3-account-page"'), true);

  const auth = await signIn();
  const refreshedMe = await api("/api/v1/me", { cookie: auth.cookie });
  assert.equal(refreshedMe.res.status, 200);
  const recoveredCsrf = refreshedMe.res.headers.get("x-ofa-csrf");
  assert.equal(!!recoveredCsrf, true);
  const oldCsrfAfterRefresh = await api("/api/v1/me/discoveries", { method: "POST", cookie: auth.cookie, csrf: auth.csrf, body: { discoveryType: "staging", discoveryKey: "old-csrf-after-refresh" } });
  assert.equal(oldCsrfAfterRefresh.res.status, 201);
  auth.csrf = recoveredCsrf;
  const authedSignal = await api("/api/v1/archive/records/phase4-signal-001", { cookie: auth.cookie });
  assert.equal(authedSignal.res.status, 200);
  assert.equal(authedSignal.body.record.fields.body.includes("audible"), true);
  assert.equal(authedSignal.body.record.fields.transcript, "[TRANSCRIPT WITHHELD]");
  assert.equal(JSON.stringify(authedSignal.body).includes("WE WERE NEVER ONLY RECEIVING"), false);

  const authedCase = await api("/api/v1/archive/records/phase4-case-echo", { cookie: auth.cookie });
  assert.equal(authedCase.res.status, 200);
  assert.equal(authedCase.body.record.fields.body.includes("Authenticated case body"), true);
  assert.deepEqual(authedCase.body.record.fields.personnelLinkage, []);

  const arbitraryUnlock = await api("/api/v1/me/discoveries", { method: "POST", cookie: auth.cookie, csrf: auth.csrf, body: { discoveryType: "phase4_staging", discoveryKey: "not.allowed" } });
  assert.equal(arbitraryUnlock.res.status, 400);
  const stillWithheld = await api("/api/v1/archive/records/phase4-withheld-null", { cookie: auth.cookie });
  assert.equal(stillWithheld.res.status, 404);

  for (const discoveryKey of ["phase4.signal001.transcript", "phase4.caseecho.personnel", "phase4.relationship.echo", "phase4.withheld.null"]) {
    const added = await api("/api/v1/me/discoveries", { method: "POST", cookie: auth.cookie, csrf: auth.csrf, body: { discoveryType: "phase4_staging", discoveryKey } });
    assert.equal(added.res.status, 201);
  }

  const discoveredSignal = await api("/api/v1/archive/records/phase4-signal-001", { cookie: auth.cookie });
  assert.equal(discoveredSignal.body.record.fields.transcript, "WE WERE NEVER ONLY RECEIVING.");
  assert.equal(JSON.stringify(discoveredSignal.body).includes("Archive dislikes"), false);

  const discoveredCase = await api("/api/v1/archive/records/phase4-case-echo", { cookie: auth.cookie });
  assert.deepEqual(discoveredCase.body.record.fields.personnelLinkage, ["subject-withheld", "witness-withheld"]);

  const discoveredRelationships = await api("/api/v1/archive/relationships", { cookie: auth.cookie });
  assert.equal(discoveredRelationships.body.relationships.length, 1);
  assert.equal(discoveredRelationships.body.relationships[0].relationship, "recurs_with");
  assert.equal(discoveredRelationships.body.relationships[0].source.catalogId, "phase4-signal-001");
  assert.equal(discoveredRelationships.body.relationships[0].source.id, undefined);

  const discoveredWithheld = await api("/api/v1/archive/records/phase4-withheld-null", { cookie: auth.cookie });
  assert.equal(discoveredWithheld.res.status, 200);
  assert.equal(discoveredWithheld.body.record.slug, "phase4-withheld-null");

  const normalLimited = await signIn("Phase4Limited", "phase4-limited@example.invalid");
  const normalMe = await api("/api/v1/me", { cookie: normalLimited.cookie });
  normalLimited.csrf = normalMe.res.headers.get("x-ofa-csrf");
  let normalRate;
  for (let i = 0; i < 21; i += 1) {
    normalRate = await api("/api/v1/me/discoveries", { method: "POST", cookie: normalLimited.cookie, csrf: normalLimited.csrf, body: { discoveryType: "staging", discoveryKey: `normal-limit-${i}` } });
  }
  assert.equal(normalRate.res.status, 429);

  const ownerAuth = await signIn("Phase4OwnerRate", "phase4-owner-rate@example.invalid");
  const ownerAccountId = await accountIdForUsername("Phase4OwnerRate");
  const ownerDb = new SQLiteD1Adapter(sqlitePath);
  try {
    const ownerRepo = new AuthRepository(ownerDb, { sessionPepper: "phase4-session-pepper" });
    await ownerRepo.grantRole(ownerAccountId, "owner", "global", "phase4-rate-test");
  } finally {
    ownerDb.close();
  }
  const ownerMe = await api("/api/v1/me", { cookie: ownerAuth.cookie });
  assert.equal(ownerMe.res.status, 200);
  assert.equal(JSON.stringify(ownerMe.body).includes("owner"), false);
  ownerAuth.csrf = ownerMe.res.headers.get("x-ofa-csrf");
  for (let i = 0; i < 25; i += 1) {
    const ownerRate = await api("/api/v1/me/discoveries", { method: "POST", cookie: ownerAuth.cookie, csrf: ownerAuth.csrf, body: { discoveryType: "staging", discoveryKey: `owner-limit-${i}` } });
    assert.equal(ownerRate.res.status, 201);
  }
  let ownerAuthRate;
  for (let i = 0; i < 8; i += 1) {
    ownerAuthRate = await api("/api/v1/auth/email/start", { method: "POST", body: { email: "phase4-owner-rate@example.invalid" } });
  }
  assert.equal(ownerAuthRate.res.status, 429);

  const prodRuntime = createOFAStagingServer({ config: { ...config, envName: "production", port: 0 }, logger });
  prodRuntime.server.listen(0, "127.0.0.1");
  await once(prodRuntime.server, "listening");
  const prodPage = await fetch(`http://127.0.0.1:${prodRuntime.server.address().port}/staging/archive-test.html`);
  assert.equal(prodPage.status, 404);
  const prodAccountPage = await fetch(`http://127.0.0.1:${prodRuntime.server.address().port}/staging/account-test.html`);
  assert.equal(prodAccountPage.status, 404);
  const prodGrant = await fetch(`http://127.0.0.1:${prodRuntime.server.address().port}/api/v1/me/discoveries`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ discoveryType: "phase4_staging", discoveryKey: "phase4.signal001.transcript" })
  });
  assert.equal(prodGrant.status, 401);
  prodRuntime.server.close();

  console.log("phase 4 archive surface tests passed");
} finally {
  runtime.server.close();
}

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { backupSQLiteDatabase } from "../src/backup/sqlite-backup.js";
import { applyMigrations } from "../src/db/migrations.js";
import { SQLiteD1Adapter } from "../src/db/sqlite-adapter.js";
import { AuthRepository } from "../src/repositories/auth-repository.js";
import { createOFAStagingServer } from "../src/server/server.js";
import { copySQLiteStorageForMigration } from "../src/storage/storage-migration.js";

const testDir = dirname(fileURLToPath(import.meta.url));
const backendDir = dirname(testDir);
const tempDir = mkdtempSync(join(tmpdir(), "ofa-phase3-"));
const staticRoot = mkdtempSync(join(tmpdir(), "ofa-phase3-static-"));
const sqlitePath = join(tempDir, "phase3.sqlite");
const fieldKey = Buffer.alloc(32, 7).toString("base64");
const logs = [];
const logger = {
  debug: (message, detail) => logs.push({ level: "debug", message, detail }),
  info: (message, detail) => logs.push({ level: "info", message, detail }),
  warn: (message, detail) => logs.push({ level: "warn", message, detail }),
  error: (message, detail) => logs.push({ level: "error", message, detail })
};

const db = new SQLiteD1Adapter(sqlitePath);
await applyMigrations(db, join(backendDir, "migrations-server"));
db.close();

const config = {
  envName: "staging",
  host: "127.0.0.1",
  port: 0,
  staticRoot,
  logLevel: "debug",
  sqlitePath,
  sessionPepper: "phase3-session-pepper",
  identityPepper: "phase3-identity-pepper",
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
const { port } = runtime.server.address();
const base = `http://127.0.0.1:${port}`;

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

try {
  const reserved = await api("/api/v1/auth/register", { method: "POST", body: { username: "Admin", email: "admin@example.invalid" } });
  assert.equal(reserved.res.status, 400);
  assert.equal(reserved.body.error.code, "reserved_username");
  const invalidEmail = await api("/api/v1/auth/register", { method: "POST", body: { username: "ValidUser", email: "not-email" } });
  assert.equal(invalidEmail.res.status, 400);
  assert.equal(invalidEmail.body.error.code, "invalid_email");

  const registered = await api("/api/v1/auth/register", { method: "POST", body: { username: "LuKe-Test", email: "luke@example.invalid" } });
  assert.equal(registered.res.status, 201);
  assert.equal(registered.body.account.username, "LuKe-Test");
  assert.equal(registered.body.account.id, undefined);
  assert.equal(registered.body.account.archiveIdentity.designation.startsWith("VISITOR-"), true);

  const duplicateCase = await api("/api/v1/auth/register", { method: "POST", body: { username: "luke-test", email: "other@example.invalid" } });
  assert.equal(duplicateCase.res.status, 400);
  assert.equal(duplicateCase.body.error.code, "username_unavailable");

  const dbCheck = new SQLiteD1Adapter(sqlitePath);
  const sensitive = await dbCheck.prepare("SELECT encrypted_value FROM sensitive_identity_data LIMIT 1").first();
  assert.equal(String(sensitive.encrypted_value).includes("luke@example.invalid"), false);
  assert.equal(await dbCheck.prepare("SELECT provider_subject FROM external_identities WHERE provider = 'email'").first().then((row) => row.provider_subject.length), 64);
  dbCheck.close();

  const started = await api("/api/v1/auth/email/start", { method: "POST", body: { email: "luke@example.invalid" } });
  assert.equal(started.res.status, 202);
  assert.equal(started.body.ok, true);
  const tokenLog = logs.find((entry) => entry.message === "local_staging_email_link");
  assert.equal(!!tokenLog?.detail?.token, true);
  const tokenDb = new SQLiteD1Adapter(sqlitePath);
  const storedEmailToken = await tokenDb.prepare("SELECT token_digest FROM auth_email_challenges ORDER BY created_at DESC LIMIT 1").first();
  assert.notEqual(storedEmailToken.token_digest, tokenLog.detail.token);
  const authRepo = new AuthRepository(tokenDb, { sessionPepper: "phase3-session-pepper" });
  const expiredChallenge = await authRepo.createEmailChallenge({ purpose: "signin", emailDigest: "expired-digest", ttlSeconds: -1 });
  assert.equal(await authRepo.consumeEmailChallenge({ purpose: "signin", token: expiredChallenge.token }), null);
  const revokedChallenge = await authRepo.createEmailChallenge({ purpose: "signin", emailDigest: "revoked-digest", ttlSeconds: 900 });
  await authRepo.revokeEmailChallenge(revokedChallenge.id);
  assert.equal(await authRepo.consumeEmailChallenge({ purpose: "signin", token: revokedChallenge.token }), null);
  tokenDb.close();

  const completed = await api("/api/v1/auth/email/complete", { method: "POST", body: { token: tokenLog.detail.token } });
  assert.equal(completed.res.status, 200);
  const setCookie = completed.res.headers.get("set-cookie");
  const csrf = completed.res.headers.get("x-ofa-csrf");
  assert.equal(!!setCookie, true);
  assert.equal(!!csrf, true);
  const cookie = setCookie.split(";")[0];

  const replay = await api("/api/v1/auth/email/complete", { method: "POST", body: { token: tokenLog.detail.token } });
  assert.equal(replay.res.status, 400);

  const me = await api("/api/v1/me", { cookie });
  assert.equal(me.res.status, 200);
  assert.equal(me.body.account.username, "LuKe-Test");
  assert.equal(me.body.account.id, undefined);

  const noCsrf = await api("/api/v1/me/discoveries", { method: "POST", cookie, body: { discoveryType: "flag", discoveryKey: "x" } });
  assert.equal(noCsrf.res.status, 403);
  const yesCsrf = await api("/api/v1/me/discoveries", { method: "POST", cookie, csrf, body: { discoveryType: "flag", discoveryKey: "x" } });
  assert.equal(yesCsrf.res.status, 201);

  const grantOne = await api("/api/v1/staging/grant-test-item", { method: "POST", cookie, csrf, body: {} });
  const grantTwo = await api("/api/v1/staging/grant-test-item", { method: "POST", cookie, csrf, body: {} });
  assert.equal(grantOne.res.status, 201);
  assert.equal(grantTwo.body.grant.idempotent, true);
  const inventory = await api("/api/v1/me/inventory", { cookie });
  assert.equal(inventory.res.status, 200);
  assert.equal(inventory.body.inventory.balances[0].name, "Phase 3 Static Receipt");
  assert.equal(JSON.stringify(inventory.body).includes("neverSendToClient"), false);

  const logout = await api("/api/v1/auth/logout", { method: "POST", cookie, csrf, body: {} });
  assert.equal(logout.res.status, 200);
  const afterLogout = await api("/api/v1/me", { cookie });
  assert.equal(afterLogout.res.status, 401);

  let rateLimited;
  for (let i = 0; i < 9; i += 1) {
    rateLimited = await api("/api/v1/auth/email/start", { method: "POST", body: { email: "rate-limit@example.invalid" } });
  }
  assert.equal(rateLimited.res.status, 429);

  const prodRuntime = createOFAStagingServer({
    config: { ...config, envName: "production", port: 0, localEmailLinksEnabled: false },
    logger: { ...logger, warn: (message, detail) => logs.push({ level: "prod-warn", message, detail }) }
  });
  prodRuntime.server.listen(0, "127.0.0.1");
  await once(prodRuntime.server, "listening");
  const prodBase = `http://127.0.0.1:${prodRuntime.server.address().port}`;
  const prodPage = await fetch(`${prodBase}/staging/account-test.html`);
  assert.equal(prodPage.status, 404);
  const prodGrant = await fetch(`${prodBase}/api/v1/staging/grant-test-item`, { method: "POST" });
  assert.equal(prodGrant.status, 404);
  const prodStart = await fetch(`${prodBase}/api/v1/auth/email/start`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "luke@example.invalid" }) });
  assert.equal(prodStart.status, 202);
  assert.equal(logs.some((entry) => entry.level === "prod-warn" && entry.message === "local_staging_email_link"), false);
  prodRuntime.server.close();

  const backupPath = backupSQLiteDatabase(sqlitePath, join(tempDir, "backups"));
  const copiedPath = join(tempDir, "copied", "phase3-copy.sqlite");
  const copied = await copySQLiteStorageForMigration({ sourcePath: backupPath, destinationPath: copiedPath, confirm: "COPY_ONLY" });
  assert.equal(copied.ok, true);
  assert.equal(existsSync(copiedPath), true);
  assert.equal(existsSync(backupPath), true);

  const bootstrapDisabled = await new Promise((resolve) => {
    const child = spawn(process.execPath, [join(backendDir, "src", "admin", "bootstrap-owner.js"), "--username=LuKe-Test"], {
      cwd: backendDir,
      env: { ...process.env, OFA_SQLITE_PATH: sqlitePath, OFA_FIELD_ENCRYPTION_KEY_B64: fieldKey, OFA_SESSION_PEPPER: "phase3-session-pepper", OFA_IDENTITY_PEPPER: "phase3-identity-pepper" }
    });
    child.on("exit", (code) => resolve(code));
  });
  assert.equal(bootstrapDisabled, 2);

  const bootstrapEnabled = await new Promise((resolve) => {
    const child = spawn(process.execPath, [join(backendDir, "src", "admin", "bootstrap-owner.js"), "--username=LuKe-Test"], {
      cwd: backendDir,
      env: { ...process.env, OFA_SQLITE_PATH: sqlitePath, OFA_FIELD_ENCRYPTION_KEY_B64: fieldKey, OFA_SESSION_PEPPER: "phase3-session-pepper", OFA_IDENTITY_PEPPER: "phase3-identity-pepper", OFA_OWNER_BOOTSTRAP_ENABLED: "true", OFA_OWNER_BOOTSTRAP_CONFIRM: "BOOTSTRAP_OWNER" }
    });
    child.on("exit", (code) => resolve(code));
  });
  assert.equal(bootstrapEnabled, 0);

  const bootstrapSecond = await new Promise((resolve) => {
    const child = spawn(process.execPath, [join(backendDir, "src", "admin", "bootstrap-owner.js"), "--username=LuKe-Test"], {
      cwd: backendDir,
      env: { ...process.env, OFA_SQLITE_PATH: sqlitePath, OFA_FIELD_ENCRYPTION_KEY_B64: fieldKey, OFA_SESSION_PEPPER: "phase3-session-pepper", OFA_IDENTITY_PEPPER: "phase3-identity-pepper", OFA_OWNER_BOOTSTRAP_ENABLED: "true", OFA_OWNER_BOOTSTRAP_CONFIRM: "BOOTSTRAP_OWNER" }
    });
    child.on("exit", (code) => resolve(code));
  });
  assert.equal(bootstrapSecond, 3);

  const ownerStart = await api("/api/v1/auth/email/start", { method: "POST", body: { email: "luke@example.invalid" } });
  assert.equal(ownerStart.res.status, 202);
  const ownerTokenLog = logs.filter((entry) => entry.message === "local_staging_email_link").at(-1);
  const ownerCompleted = await api("/api/v1/auth/email/complete", { method: "POST", body: { token: ownerTokenLog.detail.token } });
  assert.equal(ownerCompleted.res.status, 200);
  const ownerCookie = ownerCompleted.res.headers.get("set-cookie").split(";")[0];
  const ownerMe = await api("/api/v1/me", { cookie: ownerCookie });
  assert.equal(ownerMe.res.status, 200);
  assert.deepEqual(Object.keys(ownerMe.body.account).sort(), ["archiveIdentity", "username"]);
  assert.equal(JSON.stringify(ownerMe.body).includes("owner"), false);

  const cleanupRegistered = await api("/api/v1/auth/register", { method: "POST", body: { username: "CleanupOnly", email: "cleanup@example.invalid" } });
  assert.equal(cleanupRegistered.res.status, 201);
  await api("/api/v1/auth/email/start", { method: "POST", body: { email: "cleanup@example.invalid" } });
  const cleanupTokenLog = logs.filter((entry) => entry.message === "local_staging_email_link").at(-1);
  const cleanupCompleted = await api("/api/v1/auth/email/complete", { method: "POST", body: { token: cleanupTokenLog.detail.token } });
  const cleanupCookie = cleanupCompleted.res.headers.get("set-cookie").split(";")[0];
  const cleanupCsrf = cleanupCompleted.res.headers.get("x-ofa-csrf");
  await api("/api/v1/me/discoveries", { method: "POST", cookie: cleanupCookie, csrf: cleanupCsrf, body: { discoveryType: "flag", discoveryKey: "cleanup-proof" } });
  await api("/api/v1/staging/grant-test-item", { method: "POST", cookie: cleanupCookie, csrf: cleanupCsrf, body: {} });

  const cleanupExit = await new Promise((resolve) => {
    const child = spawn(process.execPath, [join(backendDir, "src", "admin", "cleanup-staging-account.js"), "--username=CleanupOnly", "--email=cleanup@example.invalid"], {
      cwd: backendDir,
      env: { ...process.env, OFA_SQLITE_PATH: sqlitePath, OFA_FIELD_ENCRYPTION_KEY_B64: fieldKey, OFA_SESSION_PEPPER: "phase3-session-pepper", OFA_IDENTITY_PEPPER: "phase3-identity-pepper", OFA_STAGING_CLEANUP_CONFIRM: "DELETE_STAGING_TEST_ACCOUNT" }
    });
    child.on("exit", (code) => resolve(code));
  });
  assert.equal(cleanupExit, 0);
  const cleanupDb = new SQLiteD1Adapter(sqlitePath);
  const cleanupLeft = await cleanupDb.prepare(`
    SELECT COUNT(*) AS count
    FROM account_profiles
    WHERE username_normalized = 'cleanuponly'
  `).first();
  assert.equal(cleanupLeft.count, 0);
  cleanupDb.close();
  const cleanupRegisterAgain = await api("/api/v1/auth/register", { method: "POST", body: { username: "CleanupOnly", email: "cleanup@example.invalid" } });
  assert.equal(cleanupRegisterAgain.res.status, 201);

  const auditDb = new SQLiteD1Adapter(sqlitePath);
  const audits = await auditDb.prepare("SELECT action, result, context_json FROM audit_events ORDER BY created_at").all();
  const auditText = JSON.stringify(audits.results);
  assert.equal(auditText.includes(tokenLog.detail.token), false);
  assert.equal(auditText.includes("luke@example.invalid"), false);
  assert.equal(auditText.includes("owner.bootstrap"), true);
  auditDb.close();

  console.log("phase 3 accounts and identity tests passed");
} finally {
  runtime.server.close();
}

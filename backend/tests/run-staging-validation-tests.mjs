import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { seedPhase4Staging } from "../src/content/seed-phase4-staging.js";
import { applyMigrations } from "../src/db/migrations.js";
import { SQLiteD1Adapter } from "../src/db/sqlite-adapter.js";
import { createOFAStagingServer } from "../src/server/server.js";
import { runStagingValidation } from "../src/validation/run-staging-validation.js";

const backendDir = dirname(dirname(fileURLToPath(import.meta.url)));
const tempDir = mkdtempSync(join(tmpdir(), "ofa-staging-validation-"));
const sqlitePath = join(tempDir, "validation.sqlite");
const staticRoot = mkdtempSync(join(tmpdir(), "ofa-staging-validation-static-"));
const fieldKey = Buffer.alloc(32, 19).toString("base64");
const logger = { debug() {}, info() {}, warn() {}, error() {} };

const seedDb = new SQLiteD1Adapter(sqlitePath);
await applyMigrations(seedDb, join(backendDir, "migrations-server"));
await seedPhase4Staging(seedDb);
await seedDb.prepare("UPDATE operational_modes SET reason = 'preexisting-test-state', updated_at = '2025-01-02T03:04:05.000Z' WHERE mode_key = 'registrations_disabled'").run();
const originalModes = seedDb.database.prepare("SELECT mode_key, enabled, reason, updated_by, updated_at FROM operational_modes ORDER BY mode_key").all();
seedDb.close();

const config = {
  envName: "test",
  host: "127.0.0.1",
  port: 0,
  staticRoot,
  logLevel: "error",
  sqlitePath,
  sessionPepper: "staging-validation-session-pepper",
  identityPepper: "staging-validation-identity-pepper",
  fieldEncryptionKey: fieldKey,
  fieldEncryptionKeyId: "test:v1",
  sessionTtlSeconds: 3600,
  cookieSecure: false,
  localEmailLinksEnabled: true,
  workerEnv: { OFA_ALLOWED_ORIGINS: "", OFA_PUBLIC_BASE_URL: "http://127.0.0.1:0" }
};

const runtime = createOFAStagingServer({ config, logger });
runtime.server.listen(0, "127.0.0.1");
await once(runtime.server, "listening");
config.workerEnv.OFA_PUBLIC_BASE_URL = `http://127.0.0.1:${runtime.server.address().port}`;

const lines = [];
try {
  const results = await runStagingValidation({ config, output: { log: (line) => lines.push(line) } });
  assert.equal(results.some((result) => result.status === "FAIL"), false);
  assert.equal(results.some((result) => result.name === "privileged audit history" && result.status === "PASS" && result.detail === "17 request-linked entries verified"), true);
  assert.equal(results.some((result) => result.name === "emergency global session revocation" && result.status === "SKIP"), true);
  assert.equal(lines.some((line) => line.includes("MANUAL REQUIRED")), true);

  const checkDb = new SQLiteD1Adapter(sqlitePath);
  try {
    assert.equal(checkDb.database.prepare("SELECT COUNT(*) AS count FROM account_profiles WHERE username_normalized LIKE 'valadmin%' OR username_normalized LIKE 'valplayer%'").get().count, 0);
    assert.equal(checkDb.database.prepare("SELECT COUNT(*) AS count FROM inventory_item_definitions WHERE item_key LIKE 'staging_validation_item_%'").get().count, 0);
    assert.deepEqual(checkDb.database.prepare("SELECT mode_key, enabled, reason, updated_by, updated_at FROM operational_modes ORDER BY mode_key").all(), originalModes);
    assert.equal(checkDb.database.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE request_id LIKE 'staging-validation-%'").get().count, 0);
  } finally {
    checkDb.close();
  }

  await assert.rejects(
    () => runStagingValidation({ config: { ...config, envName: "production" }, output: { log() {} } }),
    /OFA_ENV must be development, staging, or test/
  );
  await assert.rejects(
    () => runStagingValidation({ config: { ...config, workerEnv: { ...config.workerEnv, OFA_PUBLIC_BASE_URL: "https://example.com" } }, output: { log() {} } }),
    /target must be loopback-only/
  );
} finally {
  runtime.server.close();
}

console.log("staging validation harness tests passed");

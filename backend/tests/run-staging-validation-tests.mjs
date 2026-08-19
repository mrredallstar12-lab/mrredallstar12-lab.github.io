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
const repoDir = dirname(backendDir);
const tempDir = mkdtempSync(join(tmpdir(), "ofa-staging-validation-"));
const sqlitePath = join(tempDir, "validation.sqlite");
const staticRoot = repoDir;
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
  assert.equal(results.some((result) => result.name === "privileged audit history" && result.status === "PASS" && Number.parseInt(result.detail, 10) >= 17), true);
  for (const name of [
    "Phase 6 kill switch",
    "canonical ingestion and compound prerequisites",
    "elevated dry-run is non-mutating",
    "six effects, sibling snapshot, and explicit chaining",
    "replay and idempotency conflict",
    "atomic rollback and chain limits",
    "serialized concurrent writes",
    "fictional and real authorization separation after progression",
    "Phase 7 rollout kill switches",
    "Phase 7 player-safe projection",
    "Phase 7 review authorization boundary",
    "Phase 7 authoritative record review",
    "Phase 7 review replay and OWNER parity",
    "Phase 7 frontend bridge boundary",
    "Phase 7 rollout switches restored",
    "Phase 8 rollout kill switch",
    "Phase 8 typed investigation and evidence boundary",
    "Phase 8 verifier neutrality and authoritative resolution",
    "Phase 8 atomic rollback, concurrency, and OWNER parity"
  ]) {
    assert.equal(results.some((result) => result.name === name && result.status === "PASS"), true, `${name} did not pass`);
  }
  assert.equal(results.some((result) => result.name === "emergency global session revocation" && result.status === "SKIP"), true);
  assert.equal(lines.some((line) => line.includes("MANUAL REQUIRED")), true);

  const checkDb = new SQLiteD1Adapter(sqlitePath);
  try {
    assert.equal(checkDb.database.prepare("SELECT COUNT(*) AS count FROM account_profiles WHERE username_normalized LIKE 'valadmin%' OR username_normalized LIKE 'valplayer%'").get().count, 0);
    assert.equal(checkDb.database.prepare("SELECT COUNT(*) AS count FROM inventory_item_definitions WHERE item_key LIKE 'staging_validation_item_%'").get().count, 0);
    assert.equal(checkDb.database.prepare("SELECT COUNT(*) AS count FROM inventory_item_definitions WHERE item_key LIKE 'phase6_validation_ticket_%'").get().count, 0);
    assert.equal(checkDb.database.prepare("SELECT COUNT(*) AS count FROM inventory_item_definitions WHERE item_key LIKE 'phase7_validation_receipt_%'").get().count, 0);
    assert.equal(checkDb.database.prepare("SELECT COUNT(*) AS count FROM authored_event_versions WHERE fixture_namespace LIKE 'staging-validation-%'").get().count, 0);
    assert.equal(checkDb.database.prepare("SELECT COUNT(*) AS count FROM authored_events WHERE event_key LIKE 'staging-validation-%'").get().count, 0);
    assert.equal(checkDb.database.prepare("SELECT COUNT(*) AS count FROM progression_events WHERE source_subject LIKE 'validation:%'").get().count, 0);
    assert.equal(checkDb.database.prepare("SELECT COUNT(*) AS count FROM archive_state_scopes WHERE scope_key LIKE 'phase6-validation-%'").get().count, 0);
    assert.equal(checkDb.database.prepare("SELECT COUNT(*) AS count FROM entity_relationships WHERE id LIKE 'rel_phase6_validation_%'").get().count, 0);
    assert.equal(checkDb.database.prepare("SELECT COUNT(*) AS count FROM records WHERE slug LIKE 'phase7-review-%' OR slug LIKE 'phase7-hidden-%' OR slug LIKE 'phase7-related-%'").get().count, 0);
    assert.equal(checkDb.database.prepare("SELECT COUNT(*) AS count FROM player_state_projection_definitions WHERE subject_key LIKE 'phase7.validation.%'").get().count, 0);
    assert.equal(checkDb.database.prepare("SELECT COUNT(*) AS count FROM records WHERE slug LIKE 'phase8-investigation-%' OR slug LIKE 'phase8-evidence-%'").get().count, 0);
    assert.equal(checkDb.database.prepare("SELECT COUNT(*) AS count FROM case_investigation_versions WHERE fixture_namespace LIKE 'staging-validation-phase8-%'").get().count, 0);
    assert.equal(checkDb.database.prepare("SELECT COUNT(*) AS count FROM canonical_interactions WHERE interaction_type LIKE 'archive.case.%'").get().count, 0);
    assert.equal(checkDb.database.prepare("SELECT COUNT(*) AS count FROM inventory_item_definitions WHERE item_key LIKE 'phase8_validation_receipt_%'").get().count, 0);
    assert.equal(checkDb.database.prepare("SELECT COUNT(*) AS count FROM progression_events WHERE event_type = 'archive.record.reviewed' AND source_subject LIKE 'acct_%'").get().count, 0);
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
  await assert.rejects(
    () => runStagingValidation({ config, output: { log() {} }, injectFailureAfterFixtures: true }),
    /injected_validation_failure_after_fixtures/
  );
  const failedRunDb = new SQLiteD1Adapter(sqlitePath);
  try {
    assert.equal(failedRunDb.database.prepare("SELECT COUNT(*) AS count FROM account_profiles WHERE username_normalized LIKE 'valadmin%' OR username_normalized LIKE 'valplayer%'").get().count, 0);
    assert.equal(failedRunDb.database.prepare("SELECT COUNT(*) AS count FROM authored_event_versions WHERE fixture_namespace LIKE 'staging-validation-%'").get().count, 0);
    assert.equal(failedRunDb.database.prepare("SELECT COUNT(*) AS count FROM archive_state_scopes WHERE scope_key LIKE 'phase6-validation-%'").get().count, 0);
    assert.equal(failedRunDb.database.prepare("SELECT COUNT(*) AS count FROM records WHERE slug LIKE 'phase7-review-%' OR slug LIKE 'phase7-hidden-%' OR slug LIKE 'phase7-related-%'").get().count, 0);
    assert.equal(failedRunDb.database.prepare("SELECT COUNT(*) AS count FROM inventory_item_definitions WHERE item_key LIKE 'phase7_validation_receipt_%'").get().count, 0);
    assert.equal(failedRunDb.database.prepare("SELECT COUNT(*) AS count FROM player_state_projection_definitions WHERE subject_key LIKE 'phase7.validation.%'").get().count, 0);
    assert.equal(failedRunDb.database.prepare("SELECT COUNT(*) AS count FROM records WHERE slug LIKE 'phase8-investigation-%' OR slug LIKE 'phase8-evidence-%'").get().count, 0);
    assert.equal(failedRunDb.database.prepare("SELECT COUNT(*) AS count FROM case_investigation_versions WHERE fixture_namespace LIKE 'staging-validation-phase8-%'").get().count, 0);
    assert.deepEqual(failedRunDb.database.prepare("SELECT mode_key, enabled, reason, updated_by, updated_at FROM operational_modes ORDER BY mode_key").all(), originalModes);
  } finally {
    failedRunDb.close();
  }
} finally {
  runtime.server.close();
}

console.log("staging validation harness tests passed");

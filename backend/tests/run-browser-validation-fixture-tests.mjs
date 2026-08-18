import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { applyMigrations } from "../src/db/migrations.js";
import { SQLiteD1Adapter } from "../src/db/sqlite-adapter.js";
import { ProgressionEngine } from "../src/progression/engine.js";
import { AccountRepository } from "../src/repositories/account-repository.js";
import { AuditRepository } from "../src/repositories/audit-repository.js";
import { AuthRepository } from "../src/repositories/auth-repository.js";
import { RateLimitRepository } from "../src/repositories/rate-limit-repository.js";
import { cleanupBrowserValidation, setupBrowserValidation } from "../src/validation/browser-validation-fixtures.js";

const backendDir = dirname(dirname(fileURLToPath(import.meta.url)));
const tempDir = mkdtempSync(join(tmpdir(), "ofa-browser-validation-"));
const sqlitePath = join(tempDir, "browser-validation.sqlite");
const statePath = join(tempDir, "browser-validation-state.json");
const manifestPath = join(tempDir, "browser-validation-manifest.json");
const fieldKey = Buffer.alloc(32, 31).toString("base64");
const config = {
  envName: "test",
  host: "127.0.0.1",
  sqlitePath,
  localEmailLinksEnabled: true,
  sessionPepper: "browser-validation-session-secret",
  identityPepper: "browser-validation-identity-secret",
  fieldEncryptionKey: fieldKey,
  fieldEncryptionKeyId: "test:v1"
};

const seedDb = new SQLiteD1Adapter(sqlitePath);
await applyMigrations(seedDb, join(backendDir, "migrations-server"));
await seedDb.prepare(`
  UPDATE operational_modes
  SET reason = 'browser-validation-preexisting', updated_by = NULL, updated_at = '2026-01-02T03:04:05.000Z'
  WHERE mode_key IN ('player_surfaces_disabled', 'authored_events_disabled')
`).run();
const originalModes = seedDb.database.prepare("SELECT mode_key, enabled, reason, updated_by, updated_at FROM operational_modes ORDER BY mode_key").all();
seedDb.close();

const outputLines = [];
const manifest = await setupBrowserValidation({ config, statePath, manifestPath, output: { log: (line) => outputLines.push(line) } });
assert.equal(existsSync(statePath), true);
assert.equal(existsSync(manifestPath), true);
assert.match(manifest.username, /^BrowserVal/);
assert.match(manifest.email, /-browser@example\.invalid$/);
assert.match(manifest.reviewRecordSlug, /^phase7-review-browser-/);
assert.equal(manifest.expectedPreReview.reviewReceiptQuantity, 0);
assert.equal(manifest.expectedPostReview.reviewReceiptQuantity, 1);
await assert.rejects(
  () => setupBrowserValidation({ config, statePath, manifestPath, output: { log() {} } }),
  /already active/
);
const printed = outputLines.join("\n");
const manifestText = readFileSync(manifestPath, "utf8");
for (const secret of [config.sessionPepper, config.identityPepper, config.fieldEncryptionKey]) {
  assert.equal(printed.includes(secret), false);
  assert.equal(manifestText.includes(secret), false);
}
for (const forbidden of ["accountId", "session", "csrf", "token", "secretMetadata", "encryption"] ) {
  assert.equal(manifestText.toLowerCase().includes(forbidden.toLowerCase()), false, `manifest exposed ${forbidden}`);
}

const activeDb = new SQLiteD1Adapter(sqlitePath);
const state = JSON.parse(readFileSync(statePath, "utf8"));
const accountId = state.player.accountId;
assert.ok(accountId);
assert.equal(activeDb.database.prepare("SELECT COUNT(*) AS count FROM account_roles WHERE account_id = ?").get(accountId).count, 0);
assert.equal(activeDb.database.prepare("SELECT COUNT(*) AS count FROM records WHERE slug = ?").get(manifest.reviewRecordSlug).count, 1);
assert.equal(activeDb.database.prepare("SELECT COUNT(*) AS count FROM authored_event_versions WHERE fixture_namespace = ?").get(state.phase7.namespace).count, 1);
for (const modeKey of ["player_surfaces_disabled", "authored_events_disabled"]) {
  assert.equal(activeDb.database.prepare("SELECT enabled FROM operational_modes WHERE mode_key = ?").get(modeKey).enabled, 0);
}

const accounts = new AccountRepository(activeDb, {
  identityPepper: config.identityPepper,
  fieldEncryptionKey: config.fieldEncryptionKey,
  fieldEncryptionKeyId: config.fieldEncryptionKeyId
});
const auth = new AuthRepository(activeDb, { sessionPepper: config.sessionPepper });
await auth.createSession({ accountId, metadata: { source: "browser-validation-test" } });
await auth.createEmailChallenge({ purpose: "signin", emailDigest: accounts.emailDigest(manifest.email), accountId, ttlSeconds: 900 });
await new RateLimitRepository(activeDb).check(`account-op:archive.record.review:${accountId}`, 30, 3600);
await new AuditRepository(activeDb).record({ actorType: "account", actorId: accountId, action: "archive.record.review", resourceType: "record", resourceId: state.phase7.reviewRecordId, result: "allowed" });
await new ProgressionEngine(activeDb, { environment: "test" }).ingest({
  eventType: "archive.record.reviewed",
  sourceType: "browser_session",
  sourceSubject: accountId,
  accountId,
  idempotencyKey: `review:${state.phase7.reviewRecordId}:test-revision`,
  payload: { catalogId: state.phase7.reviewSlug, revision: "test-revision" },
  provenance: { source: "browser_validation_test" }
});
assert.equal(activeDb.database.prepare("SELECT COUNT(*) AS count FROM progression_events WHERE account_id = ?").get(accountId).count, 1);
activeDb.close();

const cleanupResult = await cleanupBrowserValidation({ config, statePath, manifestPath, output: { log() {} } });
assert.equal(cleanupResult.cleaned, true);
assert.equal(existsSync(statePath), false);
assert.equal(existsSync(manifestPath), false);
const cleanedDb = new SQLiteD1Adapter(sqlitePath);
assert.equal(cleanedDb.database.prepare("SELECT COUNT(*) AS count FROM accounts WHERE id = ?").get(accountId).count, 0);
assert.equal(cleanedDb.database.prepare("SELECT COUNT(*) AS count FROM records WHERE slug LIKE 'phase7-%-browser-%'").get().count, 0);
assert.equal(cleanedDb.database.prepare("SELECT COUNT(*) AS count FROM authored_event_versions WHERE fixture_namespace LIKE 'staging-validation-phase7-browser-%'").get().count, 0);
assert.equal(cleanedDb.database.prepare("SELECT COUNT(*) AS count FROM inventory_item_definitions WHERE item_key LIKE 'phase7_validation_receipt_browser_%'").get().count, 0);
assert.equal(cleanedDb.database.prepare("SELECT COUNT(*) AS count FROM player_state_projection_definitions WHERE subject_key LIKE 'phase7.validation.%browser-%'").get().count, 0);
assert.deepEqual(cleanedDb.database.prepare("SELECT mode_key, enabled, reason, updated_by, updated_at FROM operational_modes ORDER BY mode_key").all(), originalModes);
cleanedDb.close();

assert.deepEqual(await cleanupBrowserValidation({ config, statePath, manifestPath, output: { log() {} } }), { cleaned: false });

await assert.rejects(
  () => setupBrowserValidation({ config, statePath, manifestPath, output: { log() {} }, injectFailureAt: "after_modes" }),
  /injected_browser_validation_failure_after_modes/
);
assert.equal(existsSync(statePath), false);
assert.equal(existsSync(manifestPath), false);
const failedDb = new SQLiteD1Adapter(sqlitePath);
assert.equal(failedDb.database.prepare("SELECT COUNT(*) AS count FROM account_profiles WHERE username_normalized LIKE 'browserval%'").get().count, 0);
assert.equal(failedDb.database.prepare("SELECT COUNT(*) AS count FROM records WHERE slug LIKE 'phase7-%-browser-%'").get().count, 0);
assert.deepEqual(failedDb.database.prepare("SELECT mode_key, enabled, reason, updated_by, updated_at FROM operational_modes ORDER BY mode_key").all(), originalModes);
failedDb.close();

await assert.rejects(
  () => setupBrowserValidation({ config: { ...config, envName: "production" }, statePath, manifestPath, output: { log() {} } }),
  /OFA_ENV must be staging or test/
);
await assert.rejects(
  () => setupBrowserValidation({ config: { ...config, envName: "development" }, statePath, manifestPath, output: { log() {} } }),
  /OFA_ENV must be staging or test/
);
await assert.rejects(
  () => setupBrowserValidation({ config: { ...config, host: "0.0.0.0" }, statePath, manifestPath, output: { log() {} } }),
  /OFA_HOST must be loopback-only/
);

const launcher = readFileSync(join(backendDir, "tools", "windows-staging-secrets.ps1"), "utf8");
assert.match(launcher, /"SetupBrowserValidation"/);
assert.match(launcher, /"CleanupBrowserValidation"/);
assert.match(launcher, /browser-validation-fixtures\.js \$fixtureAction/);
assert.doesNotMatch(launcher, /node_modules\\npm/);

console.log("browser validation fixture lifecycle tests passed");

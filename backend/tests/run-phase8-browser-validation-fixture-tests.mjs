import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { applyMigrations } from "../src/db/migrations.js";
import { SQLiteD1Adapter } from "../src/db/sqlite-adapter.js";
import { CanonicalInteractionService } from "../src/interactions/canonical-interaction-service.js";
import { cleanupPhase8BrowserValidation, setupPhase8BrowserValidation } from "../src/validation/phase8-browser-validation-fixtures.js";

const backendDir = dirname(dirname(fileURLToPath(import.meta.url)));
const tempDir = mkdtempSync(join(tmpdir(), "ofa-phase8-browser-"));
const sqlitePath = join(tempDir, "phase8.sqlite");
const statePath = join(tempDir, "phase8-state.json");
const manifestPath = join(tempDir, "phase8-manifest.json");
const fieldKey = Buffer.alloc(32, 53).toString("base64");
const config = {
  envName: "test", host: "127.0.0.1", sqlitePath, localEmailLinksEnabled: true,
  sessionPepper: "phase8-browser-session", identityPepper: "phase8-browser-identity",
  fieldEncryptionKey: fieldKey, fieldEncryptionKeyId: "test:v1"
};
const seed = new SQLiteD1Adapter(sqlitePath);
await applyMigrations(seed, join(backendDir, "migrations-server"));
await seed.prepare("UPDATE operational_modes SET reason = 'phase8-browser-preexisting', updated_at = '2026-02-03T04:05:06.000Z' WHERE mode_key IN ('player_surfaces_disabled', 'authored_events_disabled', 'investigations_disabled')").run();
const originalModes = seed.database.prepare("SELECT mode_key, enabled, reason, updated_by, updated_at FROM operational_modes ORDER BY mode_key").all();
seed.close();

const output = [];
const manifest = await setupPhase8BrowserValidation({ config, statePath, manifestPath, output: { log: (line) => output.push(line) } });
assert.equal(existsSync(statePath), true);
assert.equal(existsSync(manifestPath), true);
assert.match(manifest.username, /^Phase8Browser/);
assert.match(manifest.investigationCaseSlug, /^phase8-investigation-browser-/);
assert.equal(manifest.evidenceCandidateSlugs.length, 2);
const stateText = readFileSync(statePath, "utf8");
const manifestText = readFileSync(manifestPath, "utf8");
for (const forbidden of [config.sessionPepper, config.identityPepper, config.fieldEncryptionKey, "accountId", "csrf", "sessionToken", "verifier_ciphertext"]) {
  assert.equal(manifestText.includes(forbidden), false, `manifest exposed ${forbidden}`);
}
assert.equal(stateText.includes(config.fieldEncryptionKey), false);

const state = JSON.parse(stateText);
const db = new SQLiteD1Adapter(sqlitePath);
assert.equal(db.database.prepare("SELECT COUNT(*) AS count FROM account_roles WHERE account_id = ?").get(state.player.accountId).count, 0);
for (const mode of ["player_surfaces_disabled", "authored_events_disabled", "investigations_disabled"]) {
  assert.equal(db.database.prepare("SELECT enabled FROM operational_modes WHERE mode_key = ?").get(mode).enabled, 0);
}
const service = new CanonicalInteractionService(db, { environment: "test", fieldEncryptionKey: fieldKey });
await service.startInvestigation({ accountId: state.player.accountId, caseSlug: state.phase8.caseSlug, sourceType: "server_internal" });
const pin = await service.pinEvidence({
  accountId: state.player.accountId, caseSlug: state.phase8.caseSlug,
  targetType: "record", catalogId: state.phase8.evidenceSlugs[0], sourceType: "server_internal"
});
assert.match(pin.evidence.publicRef, /^evidence_/);
assert.equal((await service.attemptStep({
  accountId: state.player.accountId, caseSlug: state.phase8.caseSlug,
  stepKey: state.phase8.stepKey, answer: "wrong", sourceType: "server_internal"
})).accepted, false);
const suffix = state.phase8.caseSlug.slice("phase8-investigation-".length);
assert.equal((await service.attemptStep({
  accountId: state.player.accountId, caseSlug: state.phase8.caseSlug,
  stepKey: state.phase8.stepKey, answer: `recurrence ${suffix}`, sourceType: "server_internal"
})).accepted, true);
db.close();

assert.equal((await cleanupPhase8BrowserValidation({ config, statePath, manifestPath, output: { log() {} } })).cleaned, true);
assert.equal(existsSync(statePath), false);
assert.equal(existsSync(manifestPath), false);
const cleaned = new SQLiteD1Adapter(sqlitePath);
assert.equal(cleaned.database.prepare("SELECT COUNT(*) AS count FROM accounts WHERE id = ?").get(state.player.accountId).count, 0);
assert.equal(cleaned.database.prepare("SELECT COUNT(*) AS count FROM records WHERE slug LIKE 'phase8-%-browser-%'").get().count, 0);
assert.equal(cleaned.database.prepare("SELECT COUNT(*) AS count FROM case_investigation_versions WHERE fixture_namespace LIKE 'staging-validation-phase8-browser-%'").get().count, 0);
assert.deepEqual(cleaned.database.prepare("SELECT mode_key, enabled, reason, updated_by, updated_at FROM operational_modes ORDER BY mode_key").all(), originalModes);
cleaned.close();
assert.deepEqual(await cleanupPhase8BrowserValidation({ config, statePath, manifestPath, output: { log() {} } }), { cleaned: false });

await assert.rejects(
  () => setupPhase8BrowserValidation({ config, statePath, manifestPath, output: { log() {} }, injectFailureAt: "after_modes" }),
  /injected_phase8_browser_validation_failure_after_modes/
);
const failed = new SQLiteD1Adapter(sqlitePath);
assert.equal(failed.database.prepare("SELECT COUNT(*) AS count FROM account_profiles WHERE username_normalized LIKE 'phase8browser%'").get().count, 0);
assert.equal(failed.database.prepare("SELECT COUNT(*) AS count FROM records WHERE slug LIKE 'phase8-%-browser-%'").get().count, 0);
assert.deepEqual(failed.database.prepare("SELECT mode_key, enabled, reason, updated_by, updated_at FROM operational_modes ORDER BY mode_key").all(), originalModes);
failed.close();

await assert.rejects(() => setupPhase8BrowserValidation({ config: { ...config, envName: "production" }, statePath, manifestPath, output: { log() {} } }), /OFA_ENV must be staging or test/);
await assert.rejects(() => setupPhase8BrowserValidation({ config: { ...config, host: "0.0.0.0" }, statePath, manifestPath, output: { log() {} } }), /loopback-only/);

const launcher = readFileSync(join(backendDir, "tools", "windows-staging-secrets.ps1"), "utf8");
assert.match(launcher, /SetupPhase8BrowserValidation/);
assert.match(launcher, /phase8-browser-validation-fixtures\.js \$fixtureAction/);
assert.doesNotMatch(launcher, /node_modules\\npm/);

console.log("phase 8 browser validation fixture lifecycle tests passed");

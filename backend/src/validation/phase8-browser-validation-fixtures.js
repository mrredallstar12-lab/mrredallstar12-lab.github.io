import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SQLiteD1Adapter } from "../db/sqlite-adapter.js";
import { AccountRepository } from "../repositories/account-repository.js";
import { loadServerConfig } from "../server/config.js";
import { buildPhase8FixtureDescriptor, createPhase8Fixtures, deletePhase8FixtureData } from "./phase8-fixtures.js";

const ALLOWED_ENVS = new Set(["staging", "test"]);
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
const MODES = ["player_surfaces_disabled", "authored_events_disabled", "investigations_disabled"];

function assertSafe(config) {
  if (!ALLOWED_ENVS.has(config.envName)) throw new Error("Phase 8 browser validation refused: OFA_ENV must be staging or test.");
  if (!LOOPBACK_HOSTS.has(config.host)) throw new Error("Phase 8 browser validation refused: OFA_HOST must be loopback-only.");
  if (!config.sqlitePath) throw new Error("Phase 8 browser validation refused: OFA_SQLITE_PATH is required.");
  if (!config.localEmailLinksEnabled) throw new Error("Phase 8 browser validation refused: local staging email links must be enabled.");
  if (!config.identityPepper || !config.fieldEncryptionKey) throw new Error("Phase 8 browser validation refused: protected secrets are required.");
}

function paths(config, options) {
  const root = dirname(config.sqlitePath);
  return {
    state: resolve(options.statePath || join(root, "phase8-browser-validation-state.json")),
    manifest: resolve(options.manifestPath || join(root, "phase8-browser-validation-manifest.json"))
  };
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  renameSync(temporary, path);
}

function snapshotModes(db) {
  return db.database.prepare("SELECT mode_key, enabled, reason, updated_by, updated_at FROM operational_modes ORDER BY mode_key").all();
}

function restoreModes(db, snapshot) {
  const statement = db.database.prepare("UPDATE operational_modes SET enabled = ?, reason = ?, updated_by = ?, updated_at = ? WHERE mode_key = ?");
  db.transaction(() => {
    for (const row of snapshot || []) statement.run(row.enabled, row.reason, row.updated_by, row.updated_at, row.mode_key);
  });
}

function accountOptions(config) {
  return {
    identityPepper: config.identityPepper,
    fieldEncryptionKey: config.fieldEncryptionKey,
    fieldEncryptionKeyId: config.fieldEncryptionKeyId
  };
}

function hydrate(db, state) {
  if (!state.player.accountId) {
    state.player.accountId = db.database.prepare(`
      SELECT a.id FROM accounts a JOIN account_profiles p ON p.account_id = a.id
      WHERE p.username_normalized = ? LIMIT 1
    `).get(state.player.username.toLowerCase())?.id || null;
  }
  const phase8 = state.phase8;
  if (!phase8.caseRecordId) phase8.caseRecordId = db.database.prepare("SELECT id FROM records WHERE slug = ?").get(phase8.caseSlug)?.id || null;
  phase8.evidenceRecordIds = (phase8.evidenceSlugs || []).map((slug, index) =>
    phase8.evidenceRecordIds?.[index] || db.database.prepare("SELECT id FROM records WHERE slug = ?").get(slug)?.id
  ).filter(Boolean);
  if (!phase8.relationshipId && phase8.caseRecordId && phase8.evidenceRecordIds[0]) {
    phase8.relationshipId = db.database.prepare("SELECT id FROM entity_relationships WHERE source_id = ? AND target_id = ? LIMIT 1")
      .get(phase8.caseRecordId, phase8.evidenceRecordIds[0])?.id || null;
  }
}

function deleteFixture(db, state, config) {
  hydrate(db, state);
  const accountId = state.player.accountId;
  deletePhase8FixtureData(db, state.phase8, accountId ? [accountId] : []);
  const raw = db.database;
  const emailDigest = new AccountRepository(db, accountOptions(config)).emailDigest(state.player.email);
  db.transaction(() => {
    if (!accountId) return;
    raw.prepare("DELETE FROM progression_history WHERE account_id = ?").run(accountId);
    raw.prepare("DELETE FROM progression_outbox WHERE event_id IN (SELECT id FROM progression_events WHERE account_id = ?)").run(accountId);
    raw.prepare("DELETE FROM progression_effect_applications WHERE event_id IN (SELECT id FROM progression_events WHERE account_id = ?)").run(accountId);
    raw.prepare("DELETE FROM progression_rule_evaluations WHERE event_id IN (SELECT id FROM progression_events WHERE account_id = ?)").run(accountId);
    raw.prepare("DELETE FROM progression_events WHERE account_id = ?").run(accountId);
    raw.prepare("DELETE FROM audit_events WHERE actor_id = ? OR resource_id = ?").run(accountId, accountId);
    raw.prepare("DELETE FROM admin_elevations WHERE account_id = ?").run(accountId);
    raw.prepare("DELETE FROM session_csrf_tokens WHERE session_id IN (SELECT id FROM sessions WHERE account_id = ?)").run(accountId);
    raw.prepare("DELETE FROM sessions WHERE account_id = ?").run(accountId);
    raw.prepare("DELETE FROM auth_email_challenges WHERE account_id = ?").run(accountId);
    raw.prepare("DELETE FROM auth_rate_limits WHERE bucket_key LIKE ? OR bucket_key = ?").run(`%${accountId}%`, `email-start:${emailDigest}`);
    raw.prepare("DELETE FROM inventory_relationships WHERE account_id = ?").run(accountId);
    raw.prepare("DELETE FROM inventory_ledger WHERE account_id = ?").run(accountId);
    raw.prepare("DELETE FROM inventory_balances WHERE account_id = ?").run(accountId);
    raw.prepare("DELETE FROM inventory_item_instances WHERE owner_account_id = ?").run(accountId);
    raw.prepare("DELETE FROM account_discoveries WHERE account_id = ?").run(accountId);
    raw.prepare("DELETE FROM account_relationship_discoveries WHERE account_id = ?").run(accountId);
    raw.prepare("DELETE FROM account_relationships WHERE account_id = ?").run(accountId);
    raw.prepare("DELETE FROM account_annotations WHERE account_id = ?").run(accountId);
    raw.prepare("DELETE FROM account_private_state WHERE account_id = ?").run(accountId);
    raw.prepare("DELETE FROM account_roles WHERE account_id = ?").run(accountId);
    raw.prepare("DELETE FROM username_history WHERE account_id = ?").run(accountId);
    raw.prepare("DELETE FROM sensitive_identity_data WHERE account_id = ?").run(accountId);
    raw.prepare("DELETE FROM external_identities WHERE account_id = ?").run(accountId);
    raw.prepare("DELETE FROM archive_identities WHERE account_id = ?").run(accountId);
    raw.prepare("DELETE FROM account_identities WHERE account_id = ?").run(accountId);
    raw.prepare("DELETE FROM account_profiles WHERE account_id = ?").run(accountId);
    raw.prepare("DELETE FROM accounts WHERE id = ?").run(accountId);
  });
}

function manifest(state, manifestPath) {
  return {
    fixture: "phase8-browser-validation",
    createdAt: state.createdAt,
    username: state.player.username,
    email: state.player.email,
    investigationCaseSlug: state.phase8.caseSlug,
    evidenceCandidateSlugs: state.phase8.evidenceSlugs,
    stepKey: state.phase8.stepKey,
    validationPhrasePattern: "recurrence followed by the suffix in the case slug",
    expectedPreResolution: { status: "active", pins: 0, discovery: false, credential: false, relationship: false, receiptQuantity: 0 },
    expectedPostResolution: { status: "resolved", discoveryLabel: "Validation Investigation Resolution", credentialLabel: "Validation Investigator Acknowledgement", relationship: "supported_by", receiptQuantity: 1, safeReceipts: 4 },
    cleanupCommand: ".\\tools\\windows-staging-secrets.ps1 -Action CleanupPhase8BrowserValidation",
    manifestPath
  };
}

export async function setupPhase8BrowserValidation(options = {}) {
  const config = options.config || loadServerConfig(options);
  const output = options.output || console;
  assertSafe(config);
  const file = paths(config, options);
  if (existsSync(file.state)) throw new Error(`Phase 8 browser validation fixture is already active: ${file.state}`);
  const suffix = randomUUID().replaceAll("-", "").slice(0, 10);
  const phase8 = buildPhase8FixtureDescriptor(`browser-${suffix}`);
  const answer = phase8.answer;
  delete phase8.answer;
  const state = {
    version: 1, status: "setting_up", createdAt: new Date().toISOString(),
    modeSnapshot: [], player: { username: `Phase8Browser${suffix}`, email: `${suffix}-phase8-browser@example.invalid`, accountId: null },
    phase8
  };
  const db = new SQLiteD1Adapter(config.sqlitePath);
  state.modeSnapshot = snapshotModes(db);
  writeJson(file.state, state);
  try {
    const created = await new AccountRepository(db, accountOptions(config)).createAccountWithEmail({ username: state.player.username, email: state.player.email });
    if (!created.ok) throw new Error("phase8_browser_validation_account_creation_failed");
    state.player.accountId = created.accountId;
    writeJson(file.state, state);
    const fixture = {
      suffix, player: created, definitionCreatorAccountId: created.accountId,
      phase8: { ...state.phase8, answer }
    };
    await createPhase8Fixtures(db, fixture, config);
    state.phase8 = { ...fixture.phase8 };
    delete state.phase8.answer;
    writeJson(file.state, state);
    if (options.injectFailureAt === "after_fixtures") throw new Error("injected_phase8_browser_validation_failure_after_fixtures");
    if (db.database.prepare("SELECT COUNT(*) AS count FROM account_roles WHERE account_id = ?").get(created.accountId).count !== 0) {
      throw new Error("phase8_browser_validation_player_received_real_role");
    }
    db.transaction(() => {
      for (const mode of MODES) {
        db.database.prepare("UPDATE operational_modes SET enabled = 0, reason = 'phase8_browser_validation_active', updated_by = NULL, updated_at = CURRENT_TIMESTAMP WHERE mode_key = ?").run(mode);
      }
    });
    state.status = "active";
    writeJson(file.state, state);
    if (options.injectFailureAt === "after_modes") throw new Error("injected_phase8_browser_validation_failure_after_modes");
    const result = manifest(state, file.manifest);
    writeJson(file.manifest, result);
    output.log("Phase 8 browser validation fixture ready.");
    output.log(`Manifest: ${result.manifestPath}`);
    output.log(`Disposable username: ${result.username}`);
    output.log(`Disposable email: ${result.email}`);
    output.log(`Investigation case slug: ${result.investigationCaseSlug}`);
    output.log(`Evidence candidates: ${result.evidenceCandidateSlugs.join(", ")}`);
    output.log(`Validation phrase pattern: ${result.validationPhrasePattern}`);
    output.log(`Cleanup: ${result.cleanupCommand}`);
    return result;
  } catch (error) {
    try {
      deleteFixture(db, state, config);
      restoreModes(db, state.modeSnapshot);
      rmSync(file.manifest, { force: true });
      rmSync(file.state, { force: true });
    } catch (cleanupError) {
      writeJson(file.state, state);
      error.message = `${error.message}; automatic cleanup failed: ${cleanupError.message}`;
    }
    throw error;
  } finally {
    db.close();
  }
}

export async function cleanupPhase8BrowserValidation(options = {}) {
  const config = options.config || loadServerConfig(options);
  const output = options.output || console;
  assertSafe(config);
  const file = paths(config, options);
  if (!existsSync(file.state)) {
    rmSync(file.manifest, { force: true });
    output.log("No active Phase 8 browser validation fixture was found; cleanup is already complete.");
    return { cleaned: false };
  }
  const state = JSON.parse(readFileSync(file.state, "utf8"));
  const db = new SQLiteD1Adapter(config.sqlitePath);
  try {
    deleteFixture(db, state, config);
    restoreModes(db, state.modeSnapshot);
    rmSync(file.manifest, { force: true });
    rmSync(file.state, { force: true });
    output.log("Phase 8 browser validation fixture removed.");
    output.log("Previous operational-mode values restored exactly.");
    return { cleaned: true };
  } finally {
    db.close();
  }
}

const action = process.argv[2];
if (process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])) {
  const operation = action === "setup" ? setupPhase8BrowserValidation : action === "cleanup" ? cleanupPhase8BrowserValidation : null;
  if (!operation) {
    console.error("Usage: node src/validation/phase8-browser-validation-fixtures.js <setup|cleanup>");
    process.exitCode = 1;
  } else {
    operation().catch((error) => {
      console.error(`FAIL Phase 8 browser validation ${action}: ${error.message}`);
      process.exitCode = 1;
    });
  }
}

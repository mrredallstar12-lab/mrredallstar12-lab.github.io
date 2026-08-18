import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SQLiteD1Adapter } from "../db/sqlite-adapter.js";
import { AccountRepository } from "../repositories/account-repository.js";
import { loadServerConfig } from "../server/config.js";
import { buildPhase7FixtureDescriptor, createPhase7Fixtures } from "./staging-fixtures.js";

const ALLOWED_ENVS = new Set(["staging", "test"]);
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
const ROLLOUT_MODES = new Set(["player_surfaces_disabled", "authored_events_disabled"]);

function assertSafeEnvironment(config) {
  if (!ALLOWED_ENVS.has(config.envName)) throw new Error("Browser validation refused: OFA_ENV must be staging or test.");
  if (!LOOPBACK_HOSTS.has(config.host)) throw new Error("Browser validation refused: OFA_HOST must be loopback-only.");
  if (!config.sqlitePath) throw new Error("Browser validation refused: OFA_SQLITE_PATH is required.");
  if (!config.localEmailLinksEnabled) throw new Error("Browser validation refused: local staging email links must be enabled.");
  if (!config.identityPepper || !config.fieldEncryptionKey) throw new Error("Browser validation refused: protected identity secrets are required.");
}

function lifecyclePaths(config, options = {}) {
  const root = dirname(config.sqlitePath);
  return {
    statePath: resolve(options.statePath || join(root, "phase7-browser-validation-state.json")),
    manifestPath: resolve(options.manifestPath || join(root, "phase7-browser-validation-manifest.json"))
  };
}

function writeJsonAtomic(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  renameSync(temporary, path);
}

function snapshotModes(db) {
  return db.database.prepare("SELECT mode_key, enabled, reason, updated_by, updated_at FROM operational_modes ORDER BY mode_key").all();
}

function restoreModes(db, rows) {
  const statement = db.database.prepare(`
    UPDATE operational_modes
    SET enabled = ?, reason = ?, updated_by = ?, updated_at = ?
    WHERE mode_key = ?
  `);
  db.transaction(() => {
    for (const row of rows || []) statement.run(row.enabled, row.reason, row.updated_by, row.updated_at, row.mode_key);
  });
}

function browserManifest(state, manifestPath) {
  return {
    fixture: "phase7-browser-validation",
    createdAt: state.createdAt,
    username: state.player.username,
    email: state.player.email,
    reviewRecordSlug: state.phase7.reviewSlug,
    expectedPreReview: {
      finding: "[REVIEW REQUIRED]",
      projectedDiscovery: false,
      projectedCredential: false,
      projectedRelationship: false,
      reviewReceiptQuantity: 0
    },
    expectedPostReview: {
      finding: "THE VALIDATION ENVELOPE REMEMBERED THE REVIEW.",
      projectedDiscoveryLabel: "Validation Finding",
      projectedCredentialLabel: "Validation Review Acknowledgement",
      projectedRelationship: "documents",
      reviewReceiptQuantity: 1,
      playerSafeReceipts: 4
    },
    cleanupCommand: ".\\tools\\windows-staging-secrets.ps1 -Action CleanupBrowserValidation",
    manifestPath
  };
}

function printManifest(manifest, output) {
  output.log("Phase 7 browser validation fixture ready.");
  output.log(`Manifest: ${manifest.manifestPath}`);
  output.log(`Disposable username: ${manifest.username}`);
  output.log(`Disposable email: ${manifest.email}`);
  output.log(`Review record slug: ${manifest.reviewRecordSlug}`);
  output.log(`Expected before review: ${JSON.stringify(manifest.expectedPreReview)}`);
  output.log(`Expected after review: ${JSON.stringify(manifest.expectedPostReview)}`);
  output.log(`Cleanup: ${manifest.cleanupCommand}`);
}

function accountOptions(config) {
  return {
    identityPepper: config.identityPepper,
    fieldEncryptionKey: config.fieldEncryptionKey,
    fieldEncryptionKeyId: config.fieldEncryptionKeyId
  };
}

function hydrateCleanupState(db, state) {
  const phase7 = state.phase7;
  if (!state.player.accountId) {
    state.player.accountId = db.database.prepare(`
      SELECT a.id FROM accounts a
      JOIN account_profiles p ON p.account_id = a.id
      WHERE p.username_normalized = ? LIMIT 1
    `).get(state.player.username.toLowerCase())?.id || null;
  }
  for (const [property, slug] of [["reviewRecordId", phase7.reviewSlug], ["relatedRecordId", phase7.relatedSlug], ["hiddenRecordId", phase7.hiddenSlug]]) {
    if (!phase7[property]) phase7[property] = db.database.prepare("SELECT id FROM records WHERE slug = ? LIMIT 1").get(slug)?.id || null;
  }
  if (!phase7.relationshipId && phase7.reviewRecordId && phase7.relatedRecordId) {
    phase7.relationshipId = db.database.prepare(`
      SELECT id FROM entity_relationships
      WHERE source_type = 'record' AND source_id = ? AND target_type = 'record' AND target_id = ?
      LIMIT 1
    `).get(phase7.reviewRecordId, phase7.relatedRecordId)?.id || null;
  }
  if (!phase7.itemDefinitionId) {
    phase7.itemDefinitionId = db.database.prepare("SELECT id FROM inventory_item_definitions WHERE item_key = ? LIMIT 1").get(phase7.itemKey)?.id || null;
  }
  return state;
}

function deleteBrowserFixture(db, state, config) {
  hydrateCleanupState(db, state);
  const raw = db.database;
  const accountId = state.player.accountId;
  const phase7 = state.phase7;
  const recordIds = [phase7.reviewRecordId, phase7.relatedRecordId, phase7.hiddenRecordId].filter(Boolean);
  const emailDigest = new AccountRepository(db, accountOptions(config)).emailDigest(state.player.email);

  db.transaction(() => {
    if (accountId) {
      raw.prepare("DELETE FROM progression_history WHERE account_id = ?").run(accountId);
      raw.prepare("DELETE FROM progression_outbox WHERE event_id IN (SELECT id FROM progression_events WHERE account_id = ?)").run(accountId);
      raw.prepare("DELETE FROM progression_effect_applications WHERE event_id IN (SELECT id FROM progression_events WHERE account_id = ?)").run(accountId);
      raw.prepare("DELETE FROM progression_rule_evaluations WHERE event_id IN (SELECT id FROM progression_events WHERE account_id = ?)").run(accountId);
      raw.prepare("DELETE FROM progression_events WHERE account_id = ?").run(accountId);
    }
    raw.prepare("DELETE FROM authored_event_version_effects WHERE definition_version_id IN (SELECT id FROM authored_event_versions WHERE fixture_namespace = ?)").run(phase7.namespace);
    raw.prepare("DELETE FROM authored_event_versions WHERE fixture_namespace = ?").run(phase7.namespace);
    raw.prepare("DELETE FROM authored_events WHERE event_key LIKE ?").run(`${phase7.namespace}.%`);
    if (phase7.relationshipId) {
      raw.prepare("DELETE FROM account_relationship_discoveries WHERE relationship_id = ?").run(phase7.relationshipId);
      raw.prepare("DELETE FROM archive_visibility_policies WHERE resource_type = 'relationship' AND resource_id = ?").run(phase7.relationshipId);
      raw.prepare("DELETE FROM entity_relationships WHERE id = ?").run(phase7.relationshipId);
    }
    raw.prepare("DELETE FROM player_state_projection_definitions WHERE subject_key IN (?, ?)").run(phase7.discoveryKey, phase7.credentialKey);
    for (const recordId of recordIds) {
      raw.prepare("DELETE FROM record_protected_fields WHERE record_id = ?").run(recordId);
      raw.prepare("DELETE FROM archive_visibility_policies WHERE resource_type = 'record' AND resource_id = ?").run(recordId);
      raw.prepare("DELETE FROM record_access_rules WHERE record_id = ?").run(recordId);
      raw.prepare("DELETE FROM record_revisions WHERE record_id = ?").run(recordId);
      raw.prepare("DELETE FROM records WHERE id = ?").run(recordId);
    }
    if (accountId) {
      raw.prepare("DELETE FROM audit_events WHERE actor_id = ? OR resource_id = ?").run(accountId, accountId);
      raw.prepare("DELETE FROM admin_elevations WHERE account_id = ?").run(accountId);
      raw.prepare("DELETE FROM session_csrf_tokens WHERE session_id IN (SELECT id FROM sessions WHERE account_id = ?)").run(accountId);
      raw.prepare("DELETE FROM sessions WHERE account_id = ?").run(accountId);
      raw.prepare("DELETE FROM auth_email_challenges WHERE account_id = ?").run(accountId);
      raw.prepare("DELETE FROM auth_rate_limits WHERE bucket_key LIKE ? OR bucket_key = ?").run(`%${accountId}%`, `email-start:${emailDigest}`);
      raw.prepare("DELETE FROM inventory_relationships WHERE account_id = ?").run(accountId);
      raw.prepare("DELETE FROM inventory_item_history WHERE item_instance_id IN (SELECT id FROM inventory_item_instances WHERE owner_account_id = ?)").run(accountId);
      raw.prepare("DELETE FROM inventory_ledger WHERE account_id = ?").run(accountId);
      raw.prepare("DELETE FROM inventory_balances WHERE account_id = ?").run(accountId);
      raw.prepare("DELETE FROM inventory_item_instances WHERE owner_account_id = ?").run(accountId);
    }
    raw.prepare("DELETE FROM inventory_item_definitions WHERE item_key = ?").run(phase7.itemKey);
    if (accountId) {
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
    }
  });
}

export async function setupBrowserValidation(options = {}) {
  const config = options.config || loadServerConfig(options);
  const output = options.output || console;
  assertSafeEnvironment(config);
  const paths = lifecyclePaths(config, options);
  if (existsSync(paths.statePath)) throw new Error(`Browser validation fixture is already active. Run CleanupBrowserValidation first: ${paths.statePath}`);

  const suffix = randomUUID().replaceAll("-", "").slice(0, 10);
  const state = {
    version: 1,
    status: "setting_up",
    createdAt: new Date().toISOString(),
    modeSnapshot: [],
    player: {
      username: `BrowserVal${suffix}`,
      email: `${suffix}-browser@example.invalid`,
      accountId: null
    },
    phase7: buildPhase7FixtureDescriptor(`browser-${suffix}`)
  };
  const db = new SQLiteD1Adapter(config.sqlitePath);
  state.modeSnapshot = snapshotModes(db);
  writeJsonAtomic(paths.statePath, state);

  try {
    const accounts = new AccountRepository(db, accountOptions(config));
    const created = await accounts.createAccountWithEmail({ username: state.player.username, email: state.player.email });
    if (!created.ok) throw new Error(`browser_validation_account_creation_failed:${created.error?.code || "unknown"}`);
    state.player.accountId = created.accountId;
    writeJsonAtomic(paths.statePath, state);
    const fixture = {
      suffix,
      player: created,
      definitionCreatorAccountId: created.accountId,
      phase7: state.phase7
    };
    await createPhase7Fixtures(db, fixture, config);
    state.phase7 = fixture.phase7;
    writeJsonAtomic(paths.statePath, state);
    if (options.injectFailureAt === "after_fixtures") throw new Error("injected_browser_validation_failure_after_fixtures");

    const roles = db.database.prepare("SELECT COUNT(*) AS count FROM account_roles WHERE account_id = ?").get(created.accountId).count;
    if (roles !== 0) throw new Error("browser_validation_player_received_real_role");
    db.transaction(() => {
      for (const modeKey of ROLLOUT_MODES) {
        db.database.prepare(`
          UPDATE operational_modes
          SET enabled = 0, reason = 'phase7_browser_validation_active', updated_by = NULL, updated_at = CURRENT_TIMESTAMP
          WHERE mode_key = ?
        `).run(modeKey);
      }
    });
    state.status = "active";
    writeJsonAtomic(paths.statePath, state);
    if (options.injectFailureAt === "after_modes") throw new Error("injected_browser_validation_failure_after_modes");

    const manifest = browserManifest(state, paths.manifestPath);
    writeJsonAtomic(paths.manifestPath, manifest);
    printManifest(manifest, output);
    return manifest;
  } catch (error) {
    try {
      deleteBrowserFixture(db, state, config);
      restoreModes(db, state.modeSnapshot);
      rmSync(paths.manifestPath, { force: true });
      rmSync(paths.statePath, { force: true });
    } catch (cleanupError) {
      writeJsonAtomic(paths.statePath, state);
      error.message = `${error.message}; automatic cleanup failed: ${cleanupError.message}`;
    }
    throw error;
  } finally {
    db.close();
  }
}

export async function cleanupBrowserValidation(options = {}) {
  const config = options.config || loadServerConfig(options);
  const output = options.output || console;
  assertSafeEnvironment(config);
  const paths = lifecyclePaths(config, options);
  if (!existsSync(paths.statePath)) {
    rmSync(paths.manifestPath, { force: true });
    output.log("No active Phase 7 browser validation fixture was found; cleanup is already complete.");
    return { cleaned: false };
  }

  const state = JSON.parse(readFileSync(paths.statePath, "utf8"));
  const db = new SQLiteD1Adapter(config.sqlitePath);
  try {
    deleteBrowserFixture(db, state, config);
    restoreModes(db, state.modeSnapshot);
    rmSync(paths.manifestPath, { force: true });
    rmSync(paths.statePath, { force: true });
    output.log("Phase 7 browser validation fixture removed.");
    output.log("Previous operational-mode values restored exactly.");
    return { cleaned: true };
  } finally {
    db.close();
  }
}

const action = process.argv[2];
if (process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])) {
  const operation = action === "setup" ? setupBrowserValidation : action === "cleanup" ? cleanupBrowserValidation : null;
  if (!operation) {
    console.error("Usage: node src/validation/browser-validation-fixtures.js <setup|cleanup>");
    process.exitCode = 1;
  } else {
    operation().catch((error) => {
      console.error(`FAIL Phase 7 browser validation ${action}: ${error.message}`);
      process.exitCode = 1;
    });
  }
}

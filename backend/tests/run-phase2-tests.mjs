import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { backupSQLiteDatabase, restoreSQLiteBackup, verifySQLiteRestore } from "../src/backup/sqlite-backup.js";
import { applyMigrations } from "../src/db/migrations.js";
import { SQLiteD1Adapter } from "../src/db/sqlite-adapter.js";
import { AuditRepository } from "../src/repositories/audit-repository.js";
import { ArchiveStateRepository } from "../src/repositories/archive-state-repository.js";
import { AuthRepository } from "../src/repositories/auth-repository.js";
import { ContentRepository } from "../src/repositories/content-repository.js";
import { InventoryRepository } from "../src/repositories/inventory-repository.js";
import { LegacyImportRepository } from "../src/repositories/legacy-import-repository.js";
import { digestSessionToken } from "../src/security/session-tokens.js";

const testDir = dirname(fileURLToPath(import.meta.url));
const backendDir = dirname(testDir);
const tempDir = mkdtempSync(join(tmpdir(), "ofa-phase2-"));
const sqlitePath = join(tempDir, "phase2.sqlite");
const migrationsDir = join(backendDir, "migrations-server");
const db = new SQLiteD1Adapter(sqlitePath);

try {
  const applied = await applyMigrations(db, migrationsDir);
  assert.equal(applied.length, 1);
  assert.equal(applied[0].name, "0001_phase2_foundation.sql");

  const auth = new AuthRepository(db, { sessionPepper: "test-pepper" });
  const account = await auth.createAccount();
  assert.match(account.id, /^acct_/);

  const session = await auth.createSession({ accountId: account.id, ttlSeconds: 60 });
  assert.equal(typeof session.token, "string");
  const storedSession = await db.prepare("SELECT token_digest FROM sessions WHERE id = ?").bind(session.id).first();
  assert.notEqual(storedSession.token_digest, session.token);
  assert.equal(storedSession.token_digest, digestSessionToken(session.token, "test-pepper"));
  assert.equal(await auth.findActiveSessionByToken(session.token) !== null, true);
  await auth.revokeSession(session.id, "test");
  assert.equal(await auth.findActiveSessionByToken(session.token), null);
  const expired = await auth.createSession({ accountId: account.id, ttlSeconds: -1 });
  assert.equal(await auth.findActiveSessionByToken(expired.token), null);

  await auth.createRole("content_admin", "Content Admin");
  await auth.createPermission("records.publish", "Publish records");
  await auth.grantPermissionToRole("content_admin", "records.publish");
  await auth.grantRole(account.id, "content_admin");
  assert.equal(await auth.hasPermission(account.id, "records.publish"), true);
  assert.equal(await auth.hasPermission(account.id, "security.manage"), false);

  const audit = new AuditRepository(db);
  await audit.record({ actorType: "account", actorId: account.id, action: "records.publish", resourceType: "record", resourceId: "rec_test", result: "allowed", context: { requestId: "req_test" } });
  const audits = await audit.recent();
  assert.equal(audits.length, 1);
  assert.equal(audits[0].action, "records.publish");

  const inventory = new InventoryRepository(db);
  const itemDef = await inventory.createDefinition({
    itemKey: "static_coin",
    name: "Static Coin",
    itemType: "currency",
    stackable: true,
    publicMetadata: { visible: true },
    secretMetadata: { undiscovered: "not for client" }
  });
  const grantOne = await inventory.grantQuantity({ accountId: account.id, itemDefinitionId: itemDef, quantity: 3, provenance: { source: "test" }, idempotencyKey: "grant-static-1" });
  const grantTwo = await inventory.grantQuantity({ accountId: account.id, itemDefinitionId: itemDef, quantity: 3, provenance: { source: "test" }, idempotencyKey: "grant-static-1" });
  assert.equal(grantOne.id, grantTwo.id);
  assert.equal(grantTwo.idempotent, true);
  assert.equal(await inventory.balance(account.id, itemDef), 3);

  const instance = await inventory.createInstance({ accountId: account.id, itemDefinitionId: itemDef, provenance: { source: "test-instance" }, idempotencyKey: "grant-inst-1", fictionalCustody: { label: "received by clerk" } });
  assert.match(instance.id, /^iteminst_/);

  const archiveState = new ArchiveStateRepository(db);
  await archiveState.transition({ scopeType: "global", scopeKey: "archive", transitionType: "set_condition", nextState: { integrity: "stable" }, causeType: "test", actorType: "service", actorId: "phase2-test" });
  await archiveState.transition({ scopeType: "global", scopeKey: "archive", transitionType: "set_condition", nextState: { integrity: "degraded" }, causeType: "test", actorType: "service", actorId: "phase2-test" });
  const history = await archiveState.history("global", "archive");
  assert.equal(history.length, 2);
  assert.match(history[1].previous_state_json, /stable/);

  const content = new ContentRepository(db);
  const recordId = await content.createRecord({ slug: "test-record", recordType: "record", title: "Test Record", body: "Body" });
  await content.addRelationship({ sourceType: "record", sourceId: recordId, relationshipType: "mentions", targetType: "artifact", targetId: itemDef, provenance: { source: "test" } });
  await content.addDiscovery({ accountId: account.id, discoveryType: "record", discoveryKey: "test-record", resourceType: "record", resourceId: recordId });
  await content.addAnnotation({ accountId: account.id, resourceType: "record", resourceId: recordId, body: "Player note", tags: ["test"] });

  const legacy = new LegacyImportRepository(db);
  const batchId = await legacy.createBatch({ accountId: account.id, visitorLabel: "VISITOR 0001", sourceSummary: { keys: 2 } });
  await legacy.addItem({ batchId, sourceKey: "oddInventory", sourceType: "localStorage", proposedValue: { StaticCoin: 3 } });
  const legacyRow = await db.prepare("SELECT trust_level FROM legacy_import_batches WHERE id = ?").bind(batchId).first();
  assert.equal(legacyRow.trust_level, "untrusted");

  const backupDir = join(tempDir, "backups");
  const backupPath = backupSQLiteDatabase(sqlitePath, backupDir);
  const restorePath = restoreSQLiteBackup(backupPath, join(tempDir, "restore", "restored.sqlite"));
  const verified = await verifySQLiteRestore(restorePath, ["schema_migrations", "accounts", "inventory_ledger", "archive_state_history"]);
  assert.equal(verified.ok, true);

  console.log("phase 2 foundation tests passed");
} finally {
  db.close();
}

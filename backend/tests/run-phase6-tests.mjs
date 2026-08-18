import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { seedPhase4Staging } from "../src/content/seed-phase4-staging.js";
import { applyMigrations } from "../src/db/migrations.js";
import { SQLiteD1Adapter } from "../src/db/sqlite-adapter.js";
import { ProgressionEngine } from "../src/progression/engine.js";
import { evaluateCondition, validateCondition } from "../src/progression/rule-evaluator.js";
import { ArchiveStateRepository } from "../src/repositories/archive-state-repository.js";
import { AuthRepository } from "../src/repositories/auth-repository.js";
import { InventoryRepository } from "../src/repositories/inventory-repository.js";
import { PlayerStateRepository } from "../src/repositories/player-state-repository.js";
import { ProgressionDefinitionRepository } from "../src/repositories/progression-definition-repository.js";

const backendDir = dirname(dirname(fileURLToPath(import.meta.url)));
const sqlitePath = join(mkdtempSync(join(tmpdir(), "ofa-phase6-")), "phase6.sqlite");
const db = new SQLiteD1Adapter(sqlitePath);
await applyMigrations(db, join(backendDir, "migrations-server"));
await seedPhase4Staging(db);

const auth = new AuthRepository(db, { sessionPepper: "phase6-test" });
const inventory = new InventoryRepository(db);
const players = new PlayerStateRepository(db);
const state = new ArchiveStateRepository(db);
const definitions = new ProgressionDefinitionRepository(db);
const engine = new ProgressionEngine(db, { environment: "test", clock: () => new Date("2026-08-18T20:00:00.000Z") });

function hasCode(code) {
  return (error) => error?.code === code;
}

async function createPlayer(suffix) {
  const account = await auth.createAccount();
  await auth.createArchiveIdentity({ accountId: account.id, designation: `PHASE6-${suffix}`, clearanceState: { clearances: ["phase6.prerequisite"] } });
  return account.id;
}

try {
  const migrations = await db.prepare("SELECT version FROM schema_migrations ORDER BY version").all();
  assert.deepEqual(migrations.results.map((row) => row.version), ["0001", "0002", "0003", "0004", "0005"]);
  assert.equal((await db.prepare("SELECT enabled FROM operational_modes WHERE mode_key = 'authored_events_disabled'").first()).enabled, 1);

  await assert.rejects(
    () => engine.ingest({
      eventType: "phase6.staging.observation", sourceType: "staging_admin", sourceSubject: "test:disabled",
      accountId: null, idempotencyKey: "phase6-disabled-0001", payload: { signalKey: "alpha", sequence: 1 }
    }),
    hasCode("authored_events_disabled")
  );
  await db.prepare("UPDATE operational_modes SET enabled = 0, reason = 'phase6 automated test' WHERE mode_key = 'authored_events_disabled'").run();

  const accountId = await createPlayer("PRIMARY");
  const ticketId = await inventory.createDefinition({ itemKey: "phase6_ticket", name: "Phase 6 Ticket", itemType: "test", stackable: true });
  await inventory.grantQuantity({ accountId, itemDefinitionId: ticketId, quantity: 1, provenance: { source: "phase6_test" }, idempotencyKey: "phase6-prerequisite-ticket" });
  await players.addDiscovery({ accountId, discoveryType: "phase6", discoveryKey: "phase6.prerequisite", provenance: { source: "phase6_test" } });
  const relationship = await db.prepare("SELECT id FROM entity_relationships WHERE canonical = 1 LIMIT 1").first();
  await db.prepare(`
    INSERT INTO account_relationship_discoveries (account_id, relationship_id, status, provenance_json)
    VALUES (?, ?, 'active', '{}')
  `).bind(accountId, relationship.id).run();
  await state.transition({ scopeType: "global", scopeKey: "phase6-test", transitionType: "seed", nextState: { condition: "stable" }, causeType: "test" });

  const compoundCondition = {
    all: [
      { discovery: { key: "phase6.prerequisite", present: true } },
      { inventory_quantity: { itemKey: "phase6_ticket", op: "gte", value: 1 } },
      { fictional_clearance: { key: "phase6.prerequisite", present: true } },
      { prior_event_count: { eventType: "phase6.staging.observation", op: "gte", value: 1 } },
      { relationship_discovered: { relationshipId: relationship.id, present: true } },
      { archive_state: { scopeType: "global", scopeKey: "phase6-test", path: "condition", equals: "stable" } },
      { event_payload: { field: "signalKey", equals: "alpha" } },
      { not: { discovery: { key: "phase6.result", present: true } } },
      { any: [
        { event_payload: { field: "sequence", equals: 2 } },
        { fictional_clearance: { key: "phase6.alternative", present: true } }
      ] }
    ]
  };

  await definitions.createVersion({
    eventKey: "phase6.compound",
    triggerEventType: "phase6.staging.observation",
    priority: 100,
    condition: compoundCondition,
    fixtureNamespace: "phase6-test",
    effects: [
      { key: "grant-discovery", type: "discovery.set", config: { key: "phase6.result", present: true } },
      { key: "grant-inventory", type: "inventory.quantity", config: { itemKey: "phase6_ticket", delta: 2 } },
      { key: "grant-clearance", type: "fictional_clearance.set", config: { key: "phase6.granted", present: true } },
      { key: "revoke-relationship", type: "relationship.set", config: { relationshipId: relationship.id, present: false } },
      { key: "transition-state", type: "archive_state.transition", config: { scopeType: "global", scopeKey: "phase6-test", transitionType: "awaken", set: { condition: "awakened" } } },
      { key: "emit-followup", type: "event.emit", config: { eventType: "phase6.staging.followup", payload: { marker: "compound-complete" } } }
    ]
  });
  await definitions.createVersion({
    eventKey: "phase6.sibling-snapshot",
    triggerEventType: "phase6.staging.observation",
    priority: 50,
    condition: { discovery: { key: "phase6.result", present: true } },
    fixtureNamespace: "phase6-test",
    effects: [{ key: "must-not-run", type: "fictional_clearance.set", config: { key: "phase6.sibling-incorrect", present: true } }]
  });
  await definitions.createVersion({
    eventKey: "phase6.followup",
    triggerEventType: "phase6.staging.followup",
    condition: { discovery: { key: "phase6.result", present: true } },
    fixtureNamespace: "phase6-test",
    effects: [{ key: "followup-clearance", type: "fictional_clearance.set", config: { key: "phase6.followup", present: true } }]
  });

  const first = await engine.ingest({
    eventType: "phase6.staging.observation", sourceType: "staging_admin", sourceSubject: `admin:${accountId}`,
    accountId, idempotencyKey: "phase6-observation-first", payload: { signalKey: "alpha", sequence: 1 }, provenance: { source: "test" }
  });
  assert.equal(first.eventCount, 1);
  assert.equal(first.effectCount, 0);
  assert.equal(first.events[0].status, "no_match");

  const second = await engine.ingest({
    eventType: "phase6.staging.observation", sourceType: "staging_admin", sourceSubject: `admin:${accountId}`,
    accountId, idempotencyKey: "phase6-observation-second", payload: { signalKey: "alpha", sequence: 2 }, provenance: { source: "test" }
  });
  assert.equal(second.eventCount, 2);
  assert.equal(second.effectCount, 7);
  assert.equal(second.events[0].matchedDefinitions, 1);
  assert.equal(second.events[1].eventType, "phase6.staging.followup");

  const discoveries = await players.discoveries(accountId);
  assert.equal(discoveries.some((row) => row.discovery_key === "phase6.result"), true);
  assert.equal(await inventory.balance(accountId, ticketId), 3);
  const identity = await db.prepare("SELECT clearance_state_json FROM archive_identities WHERE account_id = ?").bind(accountId).first();
  const clearanceText = identity.clearance_state_json;
  assert.equal(clearanceText.includes("phase6.granted"), true);
  assert.equal(clearanceText.includes("phase6.followup"), true);
  assert.equal(clearanceText.includes("phase6.sibling-incorrect"), false);
  assert.equal((await db.prepare("SELECT status FROM account_relationship_discoveries WHERE account_id = ? AND relationship_id = ?").bind(accountId, relationship.id).first()).status, "revoked");
  assert.equal((await db.prepare("SELECT current_state_json FROM archive_state_scopes WHERE scope_type = 'global' AND scope_key = 'phase6-test'").first()).current_state_json.includes("awakened"), true);
  assert.equal((await db.prepare("SELECT COUNT(*) AS count FROM progression_history WHERE account_id = ?").bind(accountId).first()).count, 7);
  assert.equal((await db.prepare("SELECT COUNT(*) AS count FROM account_roles WHERE account_id = ?").bind(accountId).first()).count, 0);

  const replay = await engine.ingest({
    eventType: "phase6.staging.observation", sourceType: "staging_admin", sourceSubject: `admin:${accountId}`,
    accountId, idempotencyKey: "phase6-observation-second", payload: { signalKey: "alpha", sequence: 2 }
  });
  assert.equal(replay.duplicate, true);
  assert.equal(await inventory.balance(accountId, ticketId), 3);
  await assert.rejects(
    () => engine.ingest({
      eventType: "phase6.staging.observation", sourceType: "staging_admin", sourceSubject: `admin:${accountId}`,
      accountId, idempotencyKey: "phase6-observation-second", payload: { signalKey: "alpha", sequence: 3 }
    }),
    hasCode("idempotency_conflict")
  );

  await definitions.createVersion({
    eventKey: "phase6.rollback",
    triggerEventType: "phase6.staging.rollback",
    condition: { not: { discovery: { key: "phase6.rollback-never", present: true } } },
    fixtureNamespace: "phase6-test",
    effects: [
      { key: "temporary-discovery", type: "discovery.set", config: { key: "phase6.must-rollback", present: true } },
      { key: "invalid-consume", type: "inventory.quantity", config: { itemKey: "phase6_ticket", delta: -999 } }
    ]
  });
  await assert.rejects(
    () => engine.ingest({
      eventType: "phase6.staging.rollback", sourceType: "staging_admin", sourceSubject: `admin:${accountId}`,
      accountId, idempotencyKey: "phase6-rollback-event", payload: {}
    }),
    hasCode("progression_inventory_quantity_invalid")
  );
  assert.equal((await players.discoveries(accountId)).some((row) => row.discovery_key === "phase6.must-rollback"), false);
  assert.equal(await db.prepare("SELECT id FROM progression_events WHERE idempotency_key = 'phase6-rollback-event'").first(), null);

  for (let index = 1; index <= 5; index += 1) {
    await definitions.createVersion({
      eventKey: `phase6.chain.${index}`,
      triggerEventType: `phase6.staging.chain.${index}`,
      condition: { not: { discovery: { key: "phase6.chain-stop", present: true } } },
      fixtureNamespace: "phase6-test",
      effects: [{ key: "next", type: "event.emit", config: { eventType: `phase6.staging.chain.${index + 1}`, payload: {} } }]
    });
  }
  await assert.rejects(
    () => engine.ingest({
      eventType: "phase6.staging.chain.1", sourceType: "staging_admin", sourceSubject: `admin:${accountId}`,
      accountId, idempotencyKey: "phase6-chain-limit", payload: {}
    }),
    hasCode("chain_depth_limit_exceeded")
  );
  assert.equal(await db.prepare("SELECT id FROM progression_events WHERE idempotency_key = 'phase6-chain-limit'").first(), null);

  const concurrentAccount = await createPlayer("CONCURRENT");
  const concurrentTicket = await inventory.createDefinition({ itemKey: "phase6_concurrent_ticket", name: "Concurrent Ticket", itemType: "test", stackable: true });
  await definitions.createVersion({
    eventKey: "phase6.concurrent",
    triggerEventType: "archive.record.accessed",
    condition: { event_payload: { field: "catalogId", equals: "phase4-signal-001" } },
    fixtureNamespace: "phase6-test",
    effects: [{ key: "increment", type: "inventory.quantity", config: { itemKey: "phase6_concurrent_ticket", delta: 1 } }]
  });

  const sameKeyResults = await Promise.all([
    engine.ingest({ eventType: "archive.record.accessed", sourceType: "server", sourceSubject: `server:${concurrentAccount}`, accountId: concurrentAccount, idempotencyKey: "phase6-concurrent-same", payload: { catalogId: "phase4-signal-001" } }),
    engine.ingest({ eventType: "archive.record.accessed", sourceType: "server", sourceSubject: `server:${concurrentAccount}`, accountId: concurrentAccount, idempotencyKey: "phase6-concurrent-same", payload: { catalogId: "phase4-signal-001" } })
  ]);
  assert.equal(sameKeyResults.filter((result) => result.duplicate).length, 1);
  assert.equal(await inventory.balance(concurrentAccount, concurrentTicket), 1);

  await Promise.all(Array.from({ length: 12 }, (_, index) => engine.ingest({
    eventType: "archive.record.accessed", sourceType: "server", sourceSubject: `server:${concurrentAccount}`,
    accountId: concurrentAccount, idempotencyKey: `phase6-concurrent-${index}`, payload: { catalogId: "phase4-signal-001" }
  })));
  assert.equal(await inventory.balance(concurrentAccount, concurrentTicket), 13);

  const beforeSimulationEvents = (await db.prepare("SELECT COUNT(*) AS count FROM progression_events").first()).count;
  const beforeSimulationBalance = await inventory.balance(concurrentAccount, concurrentTicket);
  const simulation = await engine.simulate({
    eventType: "archive.record.accessed", sourceType: "server", sourceSubject: `simulation:${concurrentAccount}`,
    accountId: concurrentAccount, idempotencyKey: "phase6-simulation-only", payload: { catalogId: "phase4-signal-001" }
  });
  assert.equal(simulation.dryRun, true);
  assert.equal(simulation.committed, false);
  assert.equal((await db.prepare("SELECT COUNT(*) AS count FROM progression_events").first()).count, beforeSimulationEvents);
  assert.equal(await inventory.balance(concurrentAccount, concurrentTicket), beforeSimulationBalance);

  const syntheticSnapshot = {
    discoveries: new Set(["d"]),
    inventoryQuantities: new Map([["i", 2]]),
    inventoryInstances: [{ itemKey: "instance", state: "held" }],
    clearances: new Set(["c"]),
    priorEventCounts: new Map([["e", 3]]),
    relationships: new Set(["r"]),
    archiveStates: new Map([["global:x", { condition: "stable" }]]),
    eventPayload: { key: "value" }
  };
  const everyLeaf = { all: [
    { discovery: { key: "d" } },
    { inventory_quantity: { itemKey: "i", op: "gte", value: 2 } },
    { inventory_instance: { itemKey: "instance", state: "held" } },
    { fictional_clearance: { key: "c" } },
    { prior_event_count: { eventType: "e", op: "eq", value: 3 } },
    { relationship_discovered: { relationshipId: "r" } },
    { archive_state: { scopeType: "global", scopeKey: "x", path: "condition", equals: "stable" } },
    { event_payload: { field: "key", equals: "value" } }
  ] };
  assert.equal(evaluateCondition(everyLeaf, syntheticSnapshot).matched, true);
  assert.equal(validateCondition({ all: Array.from({ length: 33 }, () => ({ discovery: { key: "x" } })) }).ok, false);
  assert.equal(validateCondition({ discovery: { key: "x", arbitrary: true } }).ok, false);

  const immutable = await definitions.createVersion({
    eventKey: "phase6.immutable",
    triggerEventType: "archive.record.accessed",
    condition: { event_payload: { field: "catalogId", equals: "phase4-signal-001" } },
    effects: [{ key: "immutable-effect", type: "discovery.set", config: { key: "phase6.immutable", present: true } }]
  });
  await assert.rejects(() => db.prepare("UPDATE authored_event_versions SET priority = 999 WHERE id = ?").bind(immutable.versionId).run(), /published_event_version_immutable/);

  await db.prepare("UPDATE operational_modes SET enabled = 1, reason = 'phase6_default_disabled_until_physical_validation' WHERE mode_key = 'authored_events_disabled'").run();
  assert.equal((await db.prepare("SELECT enabled FROM operational_modes WHERE mode_key = 'authored_events_disabled'").first()).enabled, 1);

  console.log("phase 6 progression event engine tests passed");
} finally {
  db.close();
}

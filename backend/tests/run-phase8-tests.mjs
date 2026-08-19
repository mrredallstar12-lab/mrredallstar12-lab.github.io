import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { applyMigrations } from "../src/db/migrations.js";
import { SQLiteD1Adapter } from "../src/db/sqlite-adapter.js";
import { validateInteractionCommand } from "../src/interactions/interaction-registry.js";
import { CanonicalInteractionService } from "../src/interactions/canonical-interaction-service.js";
import { AccountRepository } from "../src/repositories/account-repository.js";
import { ArchiveSurfaceRepository } from "../src/repositories/archive-surface-repository.js";
import { AuthRepository } from "../src/repositories/auth-repository.js";
import { ContentRepository } from "../src/repositories/content-repository.js";
import { InventoryRepository } from "../src/repositories/inventory-repository.js";
import { InvestigationRepository } from "../src/repositories/investigation-repository.js";
import { PlayerStateProjectionRepository } from "../src/repositories/player-state-projection-repository.js";
import { ProgressionDefinitionRepository } from "../src/repositories/progression-definition-repository.js";
import { createOFAStagingServer } from "../src/server/server.js";

const backendDir = dirname(dirname(fileURLToPath(import.meta.url)));
const sqlitePath = join(mkdtempSync(join(tmpdir(), "ofa-phase8-")), "phase8.sqlite");
const staticRoot = mkdtempSync(join(tmpdir(), "ofa-phase8-static-"));
const fieldKey = Buffer.alloc(32, 41).toString("base64");
const db = new SQLiteD1Adapter(sqlitePath);
await applyMigrations(db, join(backendDir, "migrations-server"));

const options = { identityPepper: "phase8-identity", fieldEncryptionKey: fieldKey, fieldEncryptionKeyId: "test:v1" };
const accounts = new AccountRepository(db, options);
const auth = new AuthRepository(db, { sessionPepper: "phase8-session" });
const content = new ContentRepository(db);
const surface = new ArchiveSurfaceRepository(db);
const inventory = new InventoryRepository(db);
const investigations = new InvestigationRepository(db, options);
const definitions = new ProgressionDefinitionRepository(db);
const projections = new PlayerStateProjectionRepository(db, options);

async function account(username, owner = false) {
  const created = await accounts.createAccountWithEmail({ username, email: `${username.toLowerCase()}@example.invalid` });
  assert.equal(created.ok, true);
  if (owner) await auth.grantRole(created.accountId, "owner", "global", "phase8-test");
  const session = await auth.createSession({ accountId: created.accountId, metadata: { source: "phase8-test" } });
  return { ...created, session, cookie: `ofa_session=${session.token}` };
}

const player = await account("Phase8Player");
const owner = await account("Phase8Owner", true);
const rollbackPlayer = await account("Phase8Rollback");
const caseId = await content.createRecord({
  slug: "phase8-case-envelope", recordType: "case", title: "Envelope Investigation",
  summary: "A disposable exact-answer investigation.", status: "published",
  visibility: "authenticated", body: "Pin the candidate evidence and resolve the phrase."
});
await surface.setPolicy({
  resourceType: "record", resourceId: caseId, existenceBehavior: "not_found",
  catalogRule: { access: "authenticated" }, fieldRules: { body: { access: "authenticated" } }
});
const evidenceId = await content.createRecord({
  slug: "phase8-evidence-a", recordType: "record", title: "Evidence Candidate A",
  summary: "Player-organized evidence.", status: "published", visibility: "authenticated", body: "Candidate A."
});
await surface.setPolicy({
  resourceType: "record", resourceId: evidenceId, existenceBehavior: "not_found",
  catalogRule: { access: "authenticated" }, fieldRules: { body: { access: "authenticated" } }
});
const hiddenId = await content.createRecord({
  slug: "phase8-hidden-case", recordType: "case", title: "Hidden Case",
  summary: "Must not leak.", status: "published", visibility: "restricted", body: "Must not leak."
});
await surface.setPolicy({
  resourceType: "record", resourceId: hiddenId, existenceBehavior: "not_found",
  catalogRule: { access: "discovered", discoveryKey: "phase8.hidden" },
  fieldRules: { body: { access: "discovered", discoveryKey: "phase8.hidden" } }
});
await investigations.createDefinitionVersion({
  investigationKey: "phase8.envelope", caseRecordId: caseId, version: 1, status: "published",
  title: "Envelope Investigation", summary: "Resolve the exact phrase.", fixtureNamespace: "phase8-test",
  steps: [{
    stepKey: "phrase", label: "Recovered phrase", prompt: "Enter the recovered phrase.",
    expectedAnswer: "We Were Never Only Receiving", attemptPolicy: { maxAttemptsPerHour: 6 },
    publicMetadata: { responseKind: "text" }
  }]
});
await investigations.createDefinitionVersion({
  investigationKey: "phase8.envelope", caseRecordId: caseId, version: 2, status: "draft",
  title: "Envelope Investigation Draft", fixtureNamespace: "phase8-test",
  steps: [{ stepKey: "phrase", label: "Draft", expectedAnswer: "A different answer" }]
});
const relationshipId = await content.addRelationship({
  sourceType: "record", sourceId: caseId, relationshipType: "supports",
  targetType: "record", targetId: evidenceId, canonical: true, provenance: { source: "phase8-test" }
});
await surface.setPolicy({
  resourceType: "relationship", resourceId: relationshipId, existenceBehavior: "not_found",
  relationshipRule: { access: "discovered", discoveryKey: "phase8.investigation.resolved" }
});
await inventory.createDefinition({
  itemKey: "phase8_resolution_receipt", name: "Investigation Resolution Receipt",
  itemType: "archive_property", stackable: true,
  publicMetadata: { classification: "investigation" }, secretMetadata: { acceptedAnswer: "never expose" }
});
await projections.upsertDefinition({
  subjectType: "discovery", subjectKey: "phase8.investigation.resolved",
  label: "Envelope Resolution", summary: "The envelope investigation was resolved."
});
await projections.upsertDefinition({
  subjectType: "fictional_credential", subjectKey: "phase8.investigator.acknowledged",
  label: "Investigator Acknowledgement", summary: "A fictional Archive acknowledgement."
});
await definitions.createVersion({
  eventKey: "phase8.investigation-resolution", triggerEventType: "archive.case.step.resolved",
  priority: 100, fixtureNamespace: "phase8-test",
  condition: {
    all: [
      { event_payload: { field: "caseCatalogId", equals: "phase8-case-envelope" } },
      { event_payload: { field: "stepKey", equals: "phrase" } }
    ]
  },
  playerSafeLabel: "Investigation resolved", playerSafeSummary: "Canonical investigation consequences were committed.",
  effects: [
    { key: "discovery", type: "discovery.set", config: { key: "phase8.investigation.resolved", present: true } },
    { key: "inventory", type: "inventory.quantity", config: { itemKey: "phase8_resolution_receipt", delta: 1 } },
    { key: "credential", type: "fictional_clearance.set", config: { key: "phase8.investigator.acknowledged", present: true } },
    { key: "relationship", type: "relationship.set", config: { relationshipId, present: true } }
  ]
});

const config = {
  envName: "test", host: "127.0.0.1", port: 0, staticRoot, logLevel: "error", sqlitePath,
  sessionPepper: "phase8-session", identityPepper: "phase8-identity",
  fieldEncryptionKey: fieldKey, fieldEncryptionKeyId: "test:v1",
  sessionTtlSeconds: 3600, cookieSecure: false, localEmailLinksEnabled: true,
  workerEnv: { OFA_ALLOWED_ORIGINS: "" }
};
const logger = { debug() {}, info() {}, warn() {}, error() {} };
const runtime = createOFAStagingServer({ config, logger });
runtime.server.listen(0, "127.0.0.1");
await once(runtime.server, "listening");
const base = `http://127.0.0.1:${runtime.server.address().port}`;

async function api(path, request = {}) {
  const response = await fetch(`${base}${path}`, {
    method: request.method || "GET",
    headers: {
      "Content-Type": "application/json",
      ...(request.cookie ? { Cookie: request.cookie } : {}),
      ...(request.csrf ? { "X-OFA-CSRF": request.csrf } : {})
    },
    body: request.body === undefined ? undefined : JSON.stringify(request.body)
  });
  return { response, body: await response.json().catch(() => ({})) };
}

const investigationPath = "/api/v1/archive/cases/phase8-case-envelope/investigation";
async function start(actor) {
  return await api(`${investigationPath}/start`, { method: "POST", cookie: actor.cookie, csrf: actor.session.csrfToken });
}
async function attempt(actor, answer) {
  return await api(`${investigationPath}/steps/phrase/attempt`, { method: "POST", cookie: actor.cookie, csrf: actor.session.csrfToken, body: { answer } });
}

try {
  assert.deepEqual((await db.prepare("SELECT version FROM schema_migrations ORDER BY version").all()).results.map((row) => row.version), ["0001", "0002", "0003", "0004", "0005", "0006", "0007"]);
  assert.equal(validateInteractionCommand({ commandType: "arbitrary", sourceType: "browser_session", environment: "test", input: {} }).ok, false);
  assert.equal(validateInteractionCommand({ commandType: "archive.case.step.attempt", sourceType: "browser_session", environment: "test", input: { answer: "x", consequence: "grant" } }).ok, false);
  assert.equal((await api(`${investigationPath}/start`, { method: "POST", cookie: player.cookie, csrf: player.session.csrfToken })).response.status, 503);

  await db.prepare("UPDATE operational_modes SET enabled = 0 WHERE mode_key IN ('investigations_disabled', 'player_surfaces_disabled', 'authored_events_disabled')").run();
  assert.equal((await api(`${investigationPath}/start`, { method: "POST" })).response.status, 401);
  assert.equal((await api("/api/v1/archive/cases/phase8-hidden-case/investigation/start", { method: "POST", cookie: player.cookie, csrf: player.session.csrfToken })).response.status, 404);
  assert.equal((await api(`/api/v1/archive/cases/${caseId}/investigation/start`, { method: "POST", cookie: player.cookie, csrf: player.session.csrfToken })).response.status, 404);

  const started = await start(player);
  assert.equal(started.response.status, 200);
  assert.equal(started.body.result.duplicate, false);
  assert.equal((await start(player)).body.result.duplicate, true);
  const before = await api("/api/v1/me/state", { cookie: player.cookie });
  assert.equal(before.body.state.investigations.length, 1);
  assert.equal(before.body.state.investigations[0].steps[0].stepKey, "phrase");
  const secretText = JSON.stringify(before.body);
  for (const forbidden of ["We Were Never Only Receiving", "verifier_ciphertext", "eligibility_condition_json", relationshipId, player.accountId, "acceptedAnswer"]) {
    assert.equal(secretText.includes(forbidden), false, `projection exposed ${forbidden}`);
  }

  const relationshipsBefore = (await db.prepare("SELECT COUNT(*) AS count FROM entity_relationships").first()).count;
  const pin = await api(`${investigationPath}/evidence`, {
    method: "POST", cookie: player.cookie, csrf: player.session.csrfToken,
    body: { targetType: "record", catalogId: "phase8-evidence-a" }
  });
  assert.equal(pin.response.status, 200);
  assert.match(pin.body.result.evidence.publicRef, /^evidence_/);
  assert.equal((await db.prepare("SELECT COUNT(*) AS count FROM entity_relationships").first()).count, relationshipsBefore);
  const pinnedState = await api("/api/v1/me/state", { cookie: player.cookie });
  assert.equal(pinnedState.body.state.investigations[0].evidencePins[0].catalogId, "phase8-evidence-a");
  assert.notEqual(pinnedState.body.state.revision, before.body.state.revision);
  assert.equal((await api(`${investigationPath}/evidence/${pin.body.result.evidence.publicRef}`, {
    method: "DELETE", cookie: player.cookie, csrf: player.session.csrfToken
  })).response.status, 200);

  const wrong = await attempt(player, "not the phrase");
  const malformed = await attempt(player, 42);
  assert.equal(wrong.response.status, 200);
  assert.equal(malformed.response.status, 200);
  assert.deepEqual(wrong.body.result, { accepted: false, duplicate: false, limited: false });
  assert.deepEqual(malformed.body.result, { accepted: false, duplicate: false, limited: false });
  const auditText = JSON.stringify((await db.prepare("SELECT context_json FROM audit_events WHERE action LIKE 'archive.case.%'").all()).results);
  assert.equal(auditText.includes("not the phrase"), false);
  assert.equal(auditText.includes("accepted"), false);
  const storedText = JSON.stringify((await db.prepare("SELECT input_digest, provenance_json FROM canonical_interactions").all()).results);
  assert.equal(storedText.includes("not the phrase"), false);
  assert.equal(storedText.includes("We Were Never Only Receiving"), false);

  const solved = await attempt(player, "  WE   WERE never only receiving  ");
  assert.equal(solved.response.status, 200);
  assert.equal(solved.body.result.accepted, true);
  const after = await api("/api/v1/me/state", { cookie: player.cookie });
  assert.notEqual(after.body.state.revision, pinnedState.body.state.revision);
  assert.equal(after.body.state.investigations[0].status, "resolved");
  assert.equal(after.body.state.investigations[0].steps[0].resolved, true);
  assert.equal(after.body.state.discoveries[0].label, "Envelope Resolution");
  assert.equal(after.body.state.credentials[0].label, "Investigator Acknowledgement");
  assert.equal(after.body.state.inventory.balances[0].quantity, 1);
  assert.equal(after.body.state.relationships.length, 1);
  assert.equal(after.body.state.recentReceipts.length, 4);
  const replay = await attempt(player, "we were never only receiving");
  assert.equal(replay.body.result.accepted, true);
  assert.equal(replay.body.result.duplicate, true);
  assert.equal((await api("/api/v1/me/state", { cookie: player.cookie })).body.state.revision, after.body.state.revision);
  assert.equal((await db.prepare("SELECT quantity FROM inventory_balances WHERE account_id = ?").bind(player.accountId).first()).quantity, 1);

  const progressionEvent = await db.prepare("SELECT * FROM progression_events WHERE account_id = ? AND event_type = 'archive.case.step.resolved'").bind(player.accountId).first();
  assert.equal(progressionEvent.source_type, "interaction_service");
  assert.equal(JSON.parse(progressionEvent.payload_json).caseCatalogId, "phase8-case-envelope");
  const reviewSourceCount = await db.prepare("SELECT COUNT(*) AS count FROM progression_events WHERE event_type = 'archive.record.reviewed' AND source_type <> 'browser_session'").first();
  assert.equal(reviewSourceCount.count, 0);

  await start(owner);
  const ownerMe = await api("/api/v1/me", { cookie: owner.cookie });
  assert.equal(JSON.stringify(ownerMe.body).includes("owner"), false);
  const adminInspection = await api("/api/v1/admin/investigations?username=Phase8Player", { cookie: owner.cookie });
  assert.equal(adminInspection.response.status, 200);
  const adminInspectionText = JSON.stringify(adminInspection.body);
  assert.equal(adminInspectionText.includes("We Were Never Only Receiving"), false);
  assert.equal(adminInspectionText.includes("verifier"), false);
  assert.equal(adminInspectionText.includes("condition"), false);
  for (let index = 0; index < 12; index += 1) {
    assert.equal((await attempt(owner, "same wrong answer")).response.status, 200);
  }
  assert.equal((await attempt(owner, "same wrong answer")).response.status, 429);
  const ownerBucket = await db.prepare("SELECT count FROM auth_rate_limits WHERE bucket_key LIKE ?").bind(`account-op:archive.case.step.attempt:${owner.accountId}:%`).first();
  assert.equal(ownerBucket.count, 12);

  await start(rollbackPlayer);
  await definitions.createVersion({
    eventKey: "phase8.rollback", triggerEventType: "archive.case.step.resolved", priority: 101,
    fixtureNamespace: "phase8-test",
    condition: { event_payload: { field: "caseCatalogId", equals: "phase8-case-envelope" } },
    effects: [{ key: "missing", type: "inventory.quantity", config: { itemKey: "phase8_missing_definition", delta: 1 } }]
  });
  const service = new CanonicalInteractionService(db, { environment: "test", fieldEncryptionKey: fieldKey });
  await assert.rejects(() => service.attemptStep({
    accountId: rollbackPlayer.accountId, caseSlug: "phase8-case-envelope", stepKey: "phrase",
    answer: "we were never only receiving", requestId: "phase8-rollback"
  }));
  assert.equal((await db.prepare("SELECT COUNT(*) AS count FROM case_investigation_attempts a JOIN account_case_investigations i ON i.id = a.account_investigation_id WHERE i.account_id = ?").bind(rollbackPlayer.accountId).first()).count, 0);
  assert.equal((await db.prepare("SELECT COUNT(*) AS count FROM canonical_interactions WHERE account_id = ? AND interaction_type = 'archive.case.step.attempt'").bind(rollbackPlayer.accountId).first()).count, 0);
  assert.equal((await db.prepare("SELECT COUNT(*) AS count FROM progression_events WHERE account_id = ? AND event_type = 'archive.case.step.resolved'").bind(rollbackPlayer.accountId).first()).count, 0);

  const restarted = await new PlayerStateProjectionRepository(db, options).project(player.accountId);
  assert.equal(restarted.revision, after.body.state.revision);
  assert.equal(JSON.stringify(restarted).includes("verifier"), false);
} finally {
  runtime.server.close();
  await db.prepare("UPDATE operational_modes SET enabled = 1 WHERE mode_key IN ('investigations_disabled', 'player_surfaces_disabled', 'authored_events_disabled')").run();
  db.close();
}

console.log("phase 8 canonical investigation tests passed");

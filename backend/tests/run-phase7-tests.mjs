import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { applyMigrations } from "../src/db/migrations.js";
import { SQLiteD1Adapter } from "../src/db/sqlite-adapter.js";
import { AccountRepository } from "../src/repositories/account-repository.js";
import { ArchiveSurfaceRepository } from "../src/repositories/archive-surface-repository.js";
import { AuthRepository } from "../src/repositories/auth-repository.js";
import { ContentRepository } from "../src/repositories/content-repository.js";
import { InventoryRepository } from "../src/repositories/inventory-repository.js";
import { PlayerStateProjectionRepository } from "../src/repositories/player-state-projection-repository.js";
import { ProgressionDefinitionRepository } from "../src/repositories/progression-definition-repository.js";
import { createOFAStagingServer } from "../src/server/server.js";

const backendDir = dirname(dirname(fileURLToPath(import.meta.url)));
const repoDir = dirname(backendDir);
const sqlitePath = join(mkdtempSync(join(tmpdir(), "ofa-phase7-")), "phase7.sqlite");
const staticRoot = mkdtempSync(join(tmpdir(), "ofa-phase7-static-"));
const fieldKey = Buffer.alloc(32, 29).toString("base64");
const db = new SQLiteD1Adapter(sqlitePath);
await applyMigrations(db, join(backendDir, "migrations-server"));

const accountOptions = {
  identityPepper: "phase7-identity",
  fieldEncryptionKey: fieldKey,
  fieldEncryptionKeyId: "test:v1"
};
const accounts = new AccountRepository(db, accountOptions);
const auth = new AuthRepository(db, { sessionPepper: "phase7-session" });
const content = new ContentRepository(db);
const surface = new ArchiveSurfaceRepository(db);
const inventory = new InventoryRepository(db);
const projections = new PlayerStateProjectionRepository(db, accountOptions);
const definitions = new ProgressionDefinitionRepository(db);

async function createAccount(username) {
  const created = await accounts.createAccountWithEmail({ username, email: `${username.toLowerCase()}@example.invalid` });
  assert.equal(created.ok, true);
  const session = await auth.createSession({ accountId: created.accountId, metadata: { source: "phase7-test" } });
  return { ...created, session, cookie: `ofa_session=${session.token}` };
}

const player = await createAccount("Phase7Player");
const owner = await createAccount("Phase7Owner");
await auth.grantRole(owner.accountId, "owner", "global", "phase7-test");

const reviewRecordId = await content.createRecord({
  slug: "phase7-review-envelope",
  recordType: "case",
  title: "Review Envelope",
  summary: "A player-facing Phase 7 integration fixture.",
  status: "published",
  visibility: "authenticated",
  body: "The public review body is available to authenticated accounts."
});
await surface.setProtectedField({ recordId: reviewRecordId, fieldKey: "reviewFinding", value: "THE ENVELOPE REMEMBERED THE REVIEW." });
await surface.setPolicy({
  resourceType: "record",
  resourceId: reviewRecordId,
  existenceBehavior: "known_restricted",
  catalogRule: { access: "authenticated" },
  fieldRules: {
    body: { access: "authenticated" },
    reviewFinding: { access: "discovered", discoveryKey: "phase7.review.finding", redactedValue: "[REVIEW REQUIRED]" }
  }
});
const relatedRecordId = await content.createRecord({
  slug: "phase7-related-note",
  recordType: "record",
  title: "Related Review Note",
  summary: "A relationship projection fixture.",
  status: "published",
  visibility: "authenticated",
  body: "Related note."
});
const hiddenRecordId = await content.createRecord({
  slug: "phase7-hidden-review",
  recordType: "record",
  title: "Hidden Review",
  summary: "Must not leak.",
  status: "published",
  visibility: "restricted",
  body: "Must not leak."
});
await surface.setPolicy({
  resourceType: "record",
  resourceId: hiddenRecordId,
  existenceBehavior: "not_found",
  catalogRule: { access: "discovered", discoveryKey: "phase7.hidden.access" },
  fieldRules: { body: { access: "discovered", discoveryKey: "phase7.hidden.access" } }
});
const relationshipId = await content.addRelationship({
  sourceType: "record", sourceId: reviewRecordId, relationshipType: "documents",
  targetType: "record", targetId: relatedRecordId, canonical: true, provenance: { source: "phase7-test" }
});
await surface.setPolicy({
  resourceType: "relationship", resourceId: relationshipId,
  existenceBehavior: "not_found", relationshipRule: { access: "discovered", discoveryKey: "phase7.review.finding" }
});

const itemDefinitionId = await inventory.createDefinition({
  itemKey: "phase7_review_receipt",
  name: "Review Receipt",
  itemType: "archive_property",
  stackable: true,
  publicMetadata: { classification: "routine" },
  secretMetadata: { neverExpose: "phase7-secret" }
});
await projections.upsertDefinition({
  subjectType: "discovery", subjectKey: "phase7.review.finding",
  label: "Review Finding", summary: "The envelope disclosed an additional finding."
});
await projections.upsertDefinition({
  subjectType: "fictional_credential", subjectKey: "phase7.reviewed",
  label: "Review Acknowledgement", summary: "Archive review acknowledgement is active."
});
await definitions.createVersion({
  eventKey: "phase7.record-review.vertical-slice",
  triggerEventType: "archive.record.reviewed",
  priority: 100,
  condition: { event_payload: { field: "catalogId", equals: "phase7-review-envelope" } },
  fixtureNamespace: "phase7-test",
  playerSafeLabel: "Record review processed",
  playerSafeSummary: "Canonical Archive state changed after a validated review.",
  effects: [
    { key: "finding", type: "discovery.set", config: { key: "phase7.review.finding", present: true } },
    { key: "receipt", type: "inventory.quantity", config: { itemKey: "phase7_review_receipt", delta: 1 } },
    { key: "credential", type: "fictional_clearance.set", config: { key: "phase7.reviewed", present: true } },
    { key: "relationship", type: "relationship.set", config: { relationshipId, present: true } }
  ]
});
for (const accountId of [player.accountId, owner.accountId]) {
  await db.prepare(`
    INSERT INTO account_discoveries (id, account_id, discovery_type, discovery_key, provenance_json)
    VALUES (?, ?, 'internal', 'phase7.unknown.discovery', '{}')
  `).bind(`unknown_${accountId}`, accountId).run();
  await db.prepare("UPDATE archive_identities SET clearance_state_json = ? WHERE account_id = ?")
    .bind(JSON.stringify({ clearances: ["phase7.unknown.credential"] }), accountId).run();
}

const config = {
  envName: "test", host: "127.0.0.1", port: 0, staticRoot, logLevel: "error", sqlitePath,
  sessionPepper: "phase7-session", identityPepper: "phase7-identity",
  fieldEncryptionKey: fieldKey, fieldEncryptionKeyId: "test:v1",
  sessionTtlSeconds: 3600, cookieSecure: false, localEmailLinksEnabled: true,
  workerEnv: { OFA_ALLOWED_ORIGINS: "" }
};
const logger = { debug() {}, info() {}, warn() {}, error() {} };
const runtime = createOFAStagingServer({ config, logger });
runtime.server.listen(0, "127.0.0.1");
await once(runtime.server, "listening");
const base = `http://127.0.0.1:${runtime.server.address().port}`;

async function api(path, options = {}) {
  const response = await fetch(`${base}${path}`, {
    method: options.method || "GET",
    headers: {
      "Content-Type": "application/json",
      ...(options.cookie ? { Cookie: options.cookie } : {}),
      ...(options.csrf ? { "X-OFA-CSRF": options.csrf } : {}),
      ...(options.headers || {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  return { response, body: await response.json().catch(() => ({})) };
}

try {
  const bridgeSource = readFileSync(join(repoDir, "js", "ofa-api.js"), "utf8");
  const canonicalBridge = bridgeSource.slice(bridgeSource.indexOf("let canonicalPlayerState"), bridgeSource.indexOf("function pageIsPublicNormal"));
  assert.equal(canonicalBridge.includes('credentials:"include"'), true);
  assert.equal(canonicalBridge.includes('canonicalRequest("/me/state"'), true);
  assert.equal(canonicalBridge.includes('/review`'), true);
  assert.equal(canonicalBridge.includes("localStorage"), false);
  assert.equal(canonicalBridge.includes("oddInventory"), false);
  assert.equal(canonicalBridge.includes("discoveryKey"), false);
  assert.equal(readFileSync(join(repoDir, "index.html"), "utf8").includes("data-ofa-canonical-identity hidden"), true);
  assert.equal(readFileSync(join(repoDir, "pages", "inventory.html"), "utf8").includes("data-ofa-canonical-inventory hidden"), true);
  assert.equal(readFileSync(join(repoDir, "pages", "cases.html"), "utf8").includes("data-ofa-canonical-cases hidden"), true);

  assert.deepEqual((await db.prepare("SELECT version FROM schema_migrations ORDER BY version").all()).results.map((row) => row.version), ["0001", "0002", "0003", "0004", "0005", "0006", "0007"]);
  assert.equal((await db.prepare("SELECT enabled FROM operational_modes WHERE mode_key = 'player_surfaces_disabled'").first()).enabled, 1);
  assert.equal((await api("/api/v1/me/state", { cookie: player.cookie })).response.status, 503);
  assert.equal((await api("/api/v1/archive/records/phase7-review-envelope/review", { method: "POST", cookie: player.cookie, csrf: player.session.csrfToken })).response.status, 503);

  await db.prepare("UPDATE operational_modes SET enabled = 0, reason = 'phase7 test' WHERE mode_key = 'player_surfaces_disabled'").run();
  assert.equal((await api("/api/v1/me/state")).response.status, 401);
  const initial = await api("/api/v1/me/state", { cookie: player.cookie });
  assert.equal(initial.response.status, 200);
  assert.equal(initial.body.state.account.username, "Phase7Player");
  assert.equal(initial.body.state.discoveries.length, 0);
  assert.equal(initial.body.state.credentials.length, 0);
  assert.equal(initial.body.state.inventory.balances.length, 0);
  assert.equal(initial.body.state.relationships.length, 0);
  const initialText = JSON.stringify(initial.body);
  for (const forbidden of [player.accountId, "owner", "phase7.unknown.discovery", "phase7.unknown.credential", "permissions", "condition_json", "neverExpose", "phase7-secret"]) {
    assert.equal(initialText.includes(forbidden), false, `projection exposed ${forbidden}`);
  }
  const initialEtag = initial.response.headers.get("etag");
  assert.equal(!!initialEtag, true);
  assert.equal((await api("/api/v1/me/state", { cookie: player.cookie, headers: { "If-None-Match": initialEtag } })).response.status, 304);

  const arbitraryDiscovery = await api("/api/v1/me/discoveries", {
    method: "POST", cookie: player.cookie, csrf: player.session.csrfToken,
    body: { discoveryType: "progression", discoveryKey: "phase7.review.finding" }
  });
  assert.equal(arbitraryDiscovery.response.status, 400);
  const allowedFixture = await api("/api/v1/me/discoveries", {
    method: "POST", cookie: player.cookie, csrf: player.session.csrfToken,
    body: { discoveryType: "staging", discoveryKey: "phase3-account-page" }
  });
  assert.equal(allowedFixture.response.status, 201);
  const afterUnprojected = await api("/api/v1/me/state", { cookie: player.cookie });
  assert.equal(afterUnprojected.body.state.revision, initial.body.state.revision);

  assert.equal((await api("/api/v1/archive/records/phase7-review-envelope/review", { method: "POST", cookie: player.cookie, csrf: player.session.csrfToken })).response.status, 503);
  await db.prepare("UPDATE operational_modes SET enabled = 0, reason = 'phase7 test' WHERE mode_key = 'authored_events_disabled'").run();
  assert.equal((await api("/api/v1/archive/records/phase7-review-envelope/review", { method: "POST", cookie: player.cookie })).response.status, 403);
  assert.equal((await api(`/api/v1/archive/records/${reviewRecordId}/review`, { method: "POST", cookie: player.cookie, csrf: player.session.csrfToken })).response.status, 404);
  assert.equal((await api("/api/v1/archive/records/phase7-hidden-review/review", { method: "POST", cookie: player.cookie, csrf: player.session.csrfToken })).response.status, 404);

  const review = await api("/api/v1/archive/records/phase7-review-envelope/review", { method: "POST", cookie: player.cookie, csrf: player.session.csrfToken });
  assert.equal(review.response.status, 200);
  assert.equal(review.body.review.duplicate, false);
  assert.equal(review.body.review.stateChanged, true);
  const projected = await api("/api/v1/me/state", { cookie: player.cookie });
  assert.notEqual(projected.body.state.revision, initial.body.state.revision);
  assert.equal(projected.body.state.discoveries[0].label, "Review Finding");
  assert.equal(projected.body.state.credentials[0].label, "Review Acknowledgement");
  assert.equal(projected.body.state.inventory.balances[0].itemKey, "phase7_review_receipt");
  assert.equal(projected.body.state.inventory.balances[0].quantity, 1);
  assert.equal(projected.body.state.relationships.length, 1);
  assert.equal(projected.body.state.recentReceipts.length, 4);
  assert.equal(projected.body.state.recentReceipts.length <= 12, true);
  assert.equal(JSON.stringify(projected.body).includes("phase7-secret"), false);
  const revealed = await api("/api/v1/archive/records/phase7-review-envelope", { cookie: player.cookie });
  assert.equal(revealed.body.record.fields.reviewFinding, "THE ENVELOPE REMEMBERED THE REVIEW.");

  const replay = await api("/api/v1/archive/records/phase7-review-envelope/review", { method: "POST", cookie: player.cookie, csrf: player.session.csrfToken });
  assert.equal(replay.response.status, 200);
  assert.equal(replay.body.review.duplicate, true);
  assert.equal(replay.body.review.stateChanged, false);
  const replayState = await api("/api/v1/me/state", { cookie: player.cookie });
  assert.equal(replayState.body.state.revision, projected.body.state.revision);
  assert.equal(replayState.body.state.inventory.balances[0].quantity, 1);

  const restartedProjection = await new PlayerStateProjectionRepository(db, accountOptions).project(player.accountId);
  assert.equal(restartedProjection.revision, projected.body.state.revision);
  assert.equal(JSON.stringify(restartedProjection).includes("phase7.unknown"), false);

  const ownerMe = await api("/api/v1/me", { cookie: owner.cookie });
  assert.equal(JSON.stringify(ownerMe.body).includes("owner"), false);
  const ownerReview = await api("/api/v1/archive/records/phase7-review-envelope/review", { method: "POST", cookie: owner.cookie, csrf: owner.session.csrfToken });
  assert.equal(ownerReview.response.status, 200);
  for (let index = 1; index < 30; index += 1) {
    assert.equal((await api("/api/v1/archive/records/phase7-review-envelope/review", { method: "POST", cookie: owner.cookie, csrf: owner.session.csrfToken })).response.status, 200);
  }
  assert.equal((await api("/api/v1/archive/records/phase7-review-envelope/review", { method: "POST", cookie: owner.cookie, csrf: owner.session.csrfToken })).response.status, 429);
  const playerRate = await db.prepare("SELECT count FROM auth_rate_limits WHERE bucket_key = ?").bind(`account-op:archive.record.review:${player.accountId}`).first();
  const ownerRate = await db.prepare("SELECT count FROM auth_rate_limits WHERE bucket_key = ?").bind(`account-op:archive.record.review:${owner.accountId}`).first();
  assert.equal(playerRate.count, 4);
  assert.equal(ownerRate.count, 30);

  const auditRows = await db.prepare("SELECT action, context_json FROM audit_events WHERE action = 'archive.record.review'").all();
  assert.equal(auditRows.results.length >= 4, true);
  const auditText = JSON.stringify(auditRows.results);
  assert.equal(auditText.includes(player.session.token), false);
  assert.equal(auditText.includes(player.session.csrfToken), false);

  const prodRuntime = createOFAStagingServer({ config: { ...config, envName: "production", port: 0 }, logger });
  prodRuntime.server.listen(0, "127.0.0.1");
  await once(prodRuntime.server, "listening");
  try {
    const prodBase = `http://127.0.0.1:${prodRuntime.server.address().port}`;
    assert.equal((await fetch(`${prodBase}/api/v1/me/discoveries`, { headers: { Cookie: player.cookie } })).status, 404);
    assert.equal((await fetch(`${prodBase}/api/v1/me/discoveries`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: player.cookie, "X-OFA-CSRF": player.session.csrfToken }, body: JSON.stringify({ discoveryType: "staging", discoveryKey: "phase3-account-page" }) })).status, 404);
  } finally {
    prodRuntime.server.close();
  }
} finally {
  runtime.server.close();
  await db.prepare("UPDATE operational_modes SET enabled = 1, reason = 'phase7_default_disabled_until_physical_validation' WHERE mode_key = 'player_surfaces_disabled'").run();
  await db.prepare("UPDATE operational_modes SET enabled = 1, reason = 'phase6_default_disabled_until_physical_validation' WHERE mode_key = 'authored_events_disabled'").run();
  db.close();
}

console.log("phase 7 player state integration tests passed");

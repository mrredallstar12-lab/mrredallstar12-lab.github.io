import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SQLiteD1Adapter } from "../db/sqlite-adapter.js";
import { listMigrationFiles } from "../db/migrations.js";
import { ProgressionEngine } from "../progression/engine.js";
import { ProgressionDefinitionRepository } from "../repositories/progression-definition-repository.js";
import { loadServerConfig } from "../server/config.js";
import { cleanupValidationFixtures, createValidationFixtures } from "./staging-fixtures.js";

const ALLOWED_ENVS = new Set(["development", "staging", "test"]);
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
const backendDir = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

function assertCondition(value, message) {
  if (!value) throw new Error(message);
}

function cookieFrom(response) {
  return response.headers.get("set-cookie")?.split(";")[0] || "";
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
    for (const row of rows) statement.run(row.enabled, row.reason, row.updated_by, row.updated_at, row.mode_key);
  });
}

export async function runStagingValidation(options = {}) {
  const config = options.config || loadServerConfig(options);
  const output = options.output || console;
  const results = [];
  const requestPrefix = `staging-validation-${Date.now()}-`;
  let requestNumber = 0;
  let fixture;
  let modeSnapshot = [];
  let db;

  function report(status, name, detail = "") {
    results.push({ status, name, detail });
    output.log(`${status.padEnd(15)} ${name}${detail ? ` - ${detail}` : ""}`);
  }

  if (!ALLOWED_ENVS.has(config.envName)) throw new Error("Staging validation refused: OFA_ENV must be development, staging, or test.");
  if (!config.sqlitePath) throw new Error("Staging validation refused: OFA_SQLITE_PATH is required.");
  if (!config.sessionPepper || !config.identityPepper || !config.fieldEncryptionKey) {
    throw new Error("Staging validation refused: protected runtime secrets are required.");
  }

  const baseUrl = new URL(process.env.OFA_VALIDATION_BASE_URL || config.workerEnv.OFA_PUBLIC_BASE_URL);
  if (!LOOPBACK_HOSTS.has(baseUrl.hostname)) throw new Error("Staging validation refused: target must be loopback-only.");
  const base = baseUrl.origin;

  db = new SQLiteD1Adapter(config.sqlitePath);
  modeSnapshot = snapshotModes(db);

  async function api(path, options = {}) {
    const requestId = `${requestPrefix}${++requestNumber}`;
    const response = await fetch(`${base}${path}`, {
      method: options.method || "GET",
      headers: {
        "Content-Type": "application/json",
        "X-Request-Id": requestId,
        ...(options.cookie ? { Cookie: options.cookie } : {}),
        ...(options.csrf ? { "X-OFA-CSRF": options.csrf } : {})
      },
      body: options.body ? JSON.stringify(options.body) : undefined
    });
    return { response, body: await response.json().catch(() => ({})), requestId };
  }

  async function check(name, fn) {
    try {
      const detail = await fn();
      report("PASS", name, detail || "");
    } catch (error) {
      report("FAIL", name, error.message);
      throw error;
    }
  }

  try {
    await check("health", async () => {
      const { response, body } = await api("/api/v1/health");
      assertCondition(response.status === 200 && body.ok === true && body.db === true, `unexpected health response (${response.status})`);
    });

    await check("schema migrations", async () => {
      const expected = listMigrationFiles(join(backendDir, "migrations-server")).map((path) => path.split(/[\\/]/).at(-1).split("_")[0]);
      const applied = db.database.prepare("SELECT version FROM schema_migrations ORDER BY version").all().map((row) => row.version);
      assertCondition(expected.every((version) => applied.includes(version)), `missing migration; expected ${expected.join(", ")}`);
      return `${applied.length} applied`;
    });

    fixture = await createValidationFixtures(db, config);
    if (options.injectFailureAfterFixtures === true) throw new Error("injected_validation_failure_after_fixtures");
    const adminCookie = `ofa_session=${fixture.admin.session.token}`;
    const playerCookie = `ofa_session=${fixture.player.session.token}`;

    await check("admin authorization boundary", async () => {
      const denied = await api("/api/v1/admin/me", { cookie: playerCookie });
      const allowed = await api("/api/v1/admin/me", { cookie: adminCookie });
      assertCondition(denied.response.status === 403, `ordinary account received ${denied.response.status}`);
      assertCondition(allowed.response.status === 200, `system_admin received ${allowed.response.status}`);
    });

    let playerCsrf = fixture.player.session.csrfToken;
    await check("ordinary /me role hiding", async () => {
      const me = await api("/api/v1/me", { cookie: adminCookie });
      assertCondition(me.response.status === 200, `received ${me.response.status}`);
      const serialized = JSON.stringify(me.body);
      for (const forbidden of ["system_admin", "permissions", "elevated", fixture.admin.accountId, "sessionId"]) {
        assertCondition(!serialized.includes(forbidden), `ordinary /me exposed ${forbidden}`);
      }
      assertCondition(!!me.response.headers.get("x-ofa-csrf"), "missing CSRF response header");
    });

    await check("same-session CSRF", async () => {
      const secondTab = await api("/api/v1/me", { cookie: playerCookie });
      assertCondition(secondTab.response.headers.get("x-ofa-csrf") === playerCsrf, "second tab changed the session CSRF token");
      const mutation = await api("/api/v1/me/discoveries", {
        method: "POST",
        cookie: playerCookie,
        csrf: playerCsrf,
        body: { discoveryType: "phase4_staging", discoveryKey: "phase4.signal001.transcript" }
      });
      assertCondition(mutation.response.status === 201, `existing-tab mutation received ${mutation.response.status}`);
    });

    let elevatedCookie;
    let elevatedCsrf;
    await check("staging fresh-auth and elevation", async () => {
      const fresh = await api("/api/v1/admin/staging/fresh-auth-session", {
        method: "POST",
        cookie: adminCookie,
        csrf: fixture.admin.session.csrfToken,
        body: {}
      });
      assertCondition(fresh.response.status === 201, `fresh-auth helper received ${fresh.response.status}`);
      elevatedCookie = cookieFrom(fresh.response);
      elevatedCsrf = fresh.response.headers.get("x-ofa-csrf");
      assertCondition(!!elevatedCookie && !!elevatedCsrf, "fresh session material missing");
      const elevated = await api("/api/v1/admin/elevation/confirm", {
        method: "POST",
        cookie: elevatedCookie,
        csrf: elevatedCsrf,
        body: { confirm: "ELEVATE" }
      });
      assertCondition(elevated.response.status === 200, `elevation received ${elevated.response.status}`);
    });

    await check("discovery grant/revoke", async () => {
      const grant = await api(`/api/v1/admin/players/${fixture.player.accountId}/discoveries/grant`, {
        method: "POST", cookie: elevatedCookie, csrf: elevatedCsrf,
        body: { confirm: "GRANT_DISCOVERY", discoveryType: "validation", discoveryKey: `phase5.${fixture.suffix}`, reason: "staging validation harness" }
      });
      assertCondition(grant.response.status === 201, `grant received ${grant.response.status}`);
      const revoke = await api(`/api/v1/admin/players/${fixture.player.accountId}/discoveries/revoke`, {
        method: "POST", cookie: elevatedCookie, csrf: elevatedCsrf,
        body: { confirm: "REVOKE_DISCOVERY", discoveryType: "validation", discoveryKey: `phase5.${fixture.suffix}`, reason: "staging validation harness" }
      });
      assertCondition(revoke.response.status === 200 && revoke.body.revoked === 1, `revoke received ${revoke.response.status}`);
    });

    await check("inventory grant/revoke ledger", async () => {
      const grant = await api(`/api/v1/admin/players/${fixture.player.accountId}/inventory/grant`, {
        method: "POST", cookie: elevatedCookie, csrf: elevatedCsrf,
        body: { confirm: "GRANT_INVENTORY", itemKey: fixture.itemKey, name: "Staging Validation Item", quantity: 1, reason: "staging validation harness" }
      });
      assertCondition(grant.response.status === 201, `grant received ${grant.response.status}`);
      const revoke = await api(`/api/v1/admin/players/${fixture.player.accountId}/inventory/revoke`, {
        method: "POST", cookie: elevatedCookie, csrf: elevatedCsrf,
        body: { confirm: "REVOKE_INVENTORY", itemKey: fixture.itemKey, quantity: 1, reason: "staging validation harness" }
      });
      assertCondition(revoke.response.status === 200 && revoke.body.revoke.after === 0, `revoke received ${revoke.response.status}`);
      const ledger = await api(`/api/v1/admin/players/${fixture.player.accountId}/inventory-ledger`, { cookie: elevatedCookie });
      const operations = ledger.body.ledger?.map((entry) => entry.operation) || [];
      assertCondition(operations.includes("grant_quantity") && operations.includes("admin_revoke_quantity"), "grant/revoke ledger entries missing");
    });

    await check("fictional clearance typed operation", async () => {
      const changed = await api(`/api/v1/admin/players/${fixture.player.accountId}/fictional-clearance/set`, {
        method: "POST", cookie: elevatedCookie, csrf: elevatedCsrf,
        body: {
          confirm: "SET_CLEARANCE",
          clearanceState: { clearances: ["phase5.validation", "phase6.validation.prerequisite", fixture.phase7.unknownCredentialKey] },
          reason: "staging validation harness"
        }
      });
      assertCondition(changed.response.status === 200, `clearance change received ${changed.response.status}`);
      const stored = db.database.prepare("SELECT clearance_state_json FROM archive_identities WHERE account_id = ?").get(fixture.player.accountId);
      assertCondition(JSON.parse(stored.clearance_state_json).clearances?.includes("phase5.validation"), "clearance did not persist");
      const stillOrdinary = await api("/api/v1/admin/me", { cookie: playerCookie });
      assertCondition(stillOrdinary.response.status === 403, "fictional clearance granted real admin access");
    });

    await check("operational modes restore", async () => {
      const cases = [
        ["registrations_disabled", "/api/v1/auth/register", { username: `Blocked${fixture.suffix}`, email: `${fixture.suffix}-blocked@example.invalid` }],
        ["auth_initiation_disabled", "/api/v1/auth/email/start", { email: `${fixture.suffix}-player@example.invalid` }],
        ["player_mutations_disabled", "/api/v1/me/discoveries", { discoveryType: "phase4_staging", discoveryKey: "phase4.relationship.echo" }, playerCookie, playerCsrf]
      ];
      for (const [modeKey, path, body, cookie, csrf] of cases) {
        const enabled = await api("/api/v1/admin/operations/modes/set", {
          method: "POST", cookie: elevatedCookie, csrf: elevatedCsrf,
          body: { confirm: "SET_OPERATIONAL_MODE", modeKey, enabled: true, reason: "staging validation harness" }
        });
        assertCondition(enabled.response.status === 200, `${modeKey} enable received ${enabled.response.status}`);
        const blocked = await api(path, { method: "POST", cookie, csrf, body });
        assertCondition(blocked.response.status === 503 && blocked.body.error?.code === modeKey, `${modeKey} did not block its target`);
        const original = modeSnapshot.find((row) => row.mode_key === modeKey);
        const restored = await api("/api/v1/admin/operations/modes/set", {
          method: "POST", cookie: elevatedCookie, csrf: elevatedCsrf,
          body: { confirm: "SET_OPERATIONAL_MODE", modeKey, enabled: !!original.enabled, reason: "staging validation harness restore" }
        });
        assertCondition(restored.response.status === 200, `${modeKey} restore received ${restored.response.status}`);
      }
    });

    await check("Archive visibility and preview", async () => {
      const anonymous = await api("/api/v1/archive/records/phase4-signal-001");
      assertCondition(anonymous.response.status === 200, `anonymous record received ${anonymous.response.status}`);
      assertCondition(anonymous.body.record?.fields?.transcript === "[TRANSCRIPT WITHHELD]", "anonymous transcript was not withheld");
      const anonymousPreview = await api("/api/v1/admin/content/preview", {
        method: "POST", cookie: elevatedCookie, csrf: elevatedCsrf,
        body: { slug: "phase4-signal-001", as: "anonymous" }
      });
      const playerPreview = await api("/api/v1/admin/content/preview", {
        method: "POST", cookie: elevatedCookie, csrf: elevatedCsrf,
        body: { slug: "phase4-signal-001", as: "player", username: fixture.player.username }
      });
      assertCondition(anonymousPreview.response.status === 200 && playerPreview.response.status === 200, "preview request failed");
      assertCondition(JSON.stringify(anonymousPreview.body).includes("WE WERE NEVER ONLY RECEIVING.") === false, "anonymous preview exposed transcript");
      assertCondition(JSON.stringify(playerPreview.body).includes("WE WERE NEVER ONLY RECEIVING."), "discovered player preview omitted transcript");
    });

    let initialPhase7State;
    await check("Phase 7 rollout kill switches", async () => {
      const surfaceMode = modeSnapshot.find((row) => row.mode_key === "player_surfaces_disabled");
      const eventMode = modeSnapshot.find((row) => row.mode_key === "authored_events_disabled");
      assertCondition(surfaceMode?.enabled === 1 && eventMode?.enabled === 1, "Phase 7 validation must begin with both rollout switches enabled");
      const stateBlocked = await api("/api/v1/me/state", { cookie: playerCookie });
      const reviewBlocked = await api(`/api/v1/archive/records/${fixture.phase7.reviewSlug}/review`, {
        method: "POST", cookie: playerCookie, csrf: playerCsrf
      });
      assertCondition(stateBlocked.response.status === 503 && stateBlocked.body.error?.code === "player_surfaces_disabled", "player surface switch did not block projection");
      assertCondition(reviewBlocked.response.status === 503 && reviewBlocked.body.error?.code === "player_surfaces_disabled", "player surface switch did not block review");
    });

    await check("Phase 7 player-safe projection", async () => {
      const enabled = await api("/api/v1/admin/operations/modes/set", {
        method: "POST", cookie: elevatedCookie, csrf: elevatedCsrf,
        body: { confirm: "SET_OPERATIONAL_MODE", modeKey: "player_surfaces_disabled", enabled: false, reason: "staging validation harness" }
      });
      assertCondition(enabled.response.status === 200, `surface mode change returned ${enabled.response.status}`);
      const anonymous = await api("/api/v1/me/state");
      assertCondition(anonymous.response.status === 401, `anonymous state projection returned ${anonymous.response.status}`);
      const first = await api("/api/v1/me/state", { cookie: playerCookie });
      assertCondition(first.response.status === 200, `player state projection returned ${first.response.status}`);
      initialPhase7State = first.body.state;
      const unknownDiscovery = db.database.prepare("SELECT id FROM account_discoveries WHERE account_id = ? AND discovery_key = ?").get(fixture.player.accountId, fixture.phase7.unknownDiscoveryKey);
      const unknownCredentials = db.database.prepare("SELECT clearance_state_json FROM archive_identities WHERE account_id = ?").get(fixture.player.accountId);
      assertCondition(!!unknownDiscovery && JSON.parse(unknownCredentials.clearance_state_json).clearances.includes(fixture.phase7.unknownCredentialKey), "unknown projection fixtures were not present in canonical state");
      const serialized = JSON.stringify(initialPhase7State);
      for (const forbidden of [
        fixture.player.accountId, fixture.phase7.discoveryKey, fixture.phase7.credentialKey,
        fixture.phase7.unknownDiscoveryKey, fixture.phase7.unknownCredentialKey,
        "owner", "system_admin", "permissions", "condition_json", `phase7-secret-${fixture.suffix}`
      ]) assertCondition(!serialized.includes(forbidden), `player projection exposed ${forbidden}`);
      assertCondition(initialPhase7State.discoveries.length === 0 && initialPhase7State.credentials.length === 0, "unknown state was projected");
      assertCondition(initialPhase7State.inventory.balances.every((item) => item.itemKey !== fixture.phase7.itemKey), "unearned Phase 7 inventory was projected");
      const etag = first.response.headers.get("etag");
      assertCondition(!!etag, "player projection omitted ETag");
      const unchanged = await api("/api/v1/me/state", { cookie: playerCookie });
      assertCondition(unchanged.body.state.revision === initialPhase7State.revision, "unchanged projection revision was unstable");
      const cached = await fetch(`${base}/api/v1/me/state`, { headers: { Cookie: playerCookie, "If-None-Match": etag } });
      assertCondition(cached.status === 304, `matching state ETag returned ${cached.status}`);
      const fixtureOnly = await api("/api/v1/me/discoveries", {
        method: "POST", cookie: playerCookie, csrf: playerCsrf,
        body: { discoveryType: "staging", discoveryKey: "phase3-account-page" }
      });
      assertCondition(fixtureOnly.response.status === 201, `allowlisted staging discovery returned ${fixtureOnly.response.status}`);
      const arbitrary = await api("/api/v1/me/discoveries", {
        method: "POST", cookie: playerCookie, csrf: playerCsrf,
        body: { discoveryType: "progression", discoveryKey: fixture.phase7.discoveryKey }
      });
      assertCondition(arbitrary.response.status === 400 && arbitrary.body.error?.code === "unsupported_discovery", "arbitrary discovery mutation was accepted");
      const afterUnprojected = await api("/api/v1/me/state", { cookie: playerCookie });
      assertCondition(afterUnprojected.body.state.revision === initialPhase7State.revision, "unprojected canonical state changed the visible revision");
    });

    await check("Phase 7 review authorization boundary", async () => {
      const cases = await api("/api/v1/archive/cases", { cookie: playerCookie });
      assertCondition(cases.response.status === 200 && cases.body.records?.some((record) => record.slug === fixture.phase7.reviewSlug), "authenticated validation case was not listed");
      const byInternalId = await api(`/api/v1/archive/records/${fixture.phase7.reviewRecordId}/review`, {
        method: "POST", cookie: playerCookie, csrf: playerCsrf
      });
      const hidden = await api(`/api/v1/archive/records/${fixture.phase7.hiddenSlug}/review`, {
        method: "POST", cookie: playerCookie, csrf: playerCsrf
      });
      assertCondition(byInternalId.response.status === 503, "authored event switch should precede identifier probing while disabled");
      assertCondition(hidden.response.status === 503, "authored event switch should precede existence probing while disabled");
    });

    await check("Phase 8 rollout kill switch", async () => {
      const mode = modeSnapshot.find((row) => row.mode_key === "investigations_disabled");
      assertCondition(mode?.enabled === 1, "Phase 8 validation must begin with investigations disabled");
      const blocked = await api(`/api/v1/archive/cases/${fixture.phase8.caseSlug}/investigation/start`, {
        method: "POST", cookie: playerCookie, csrf: playerCsrf
      });
      assertCondition(blocked.response.status === 503 && blocked.body.error?.code === "investigations_disabled", "investigation switch did not block typed interactions");
    });

    await check("Phase 6 kill switch", async () => {
      const blocked = await api("/api/v1/admin/staging/progression/trigger", {
        method: "POST", cookie: elevatedCookie, csrf: elevatedCsrf,
        body: {
          confirm: "TRIGGER_PROGRESSION_EVENT", username: fixture.player.username,
          eventType: "phase6.staging.observation", idempotencyKey: `${fixture.phase6.namespace}-disabled`,
          payload: { signalKey: "validation", sequence: 1 }
        }
      });
      assertCondition(blocked.response.status === 503 && blocked.body.error?.code === "authored_events_disabled", `kill switch returned ${blocked.response.status}`);
      assertCondition(!db.database.prepare("SELECT id FROM progression_events WHERE idempotency_key = ?").get(`${fixture.phase6.namespace}-disabled`), "disabled event was persisted");
    });

    await check("Phase 6 enable for validation", async () => {
      const enabled = await api("/api/v1/admin/operations/modes/set", {
        method: "POST", cookie: elevatedCookie, csrf: elevatedCsrf,
        body: { confirm: "SET_OPERATIONAL_MODE", modeKey: "authored_events_disabled", enabled: false, reason: "staging validation harness" }
      });
      assertCondition(enabled.response.status === 200, `mode change returned ${enabled.response.status}`);
      db.database.prepare("UPDATE operational_modes SET enabled = 0, reason = 'staging validation harness' WHERE mode_key = 'investigations_disabled'").run();
    });

    const firstEventKey = `${fixture.phase6.namespace}-first`;
    const effectEventKey = `${fixture.phase6.namespace}-effects`;
    await check("canonical ingestion and compound prerequisites", async () => {
      const first = await api("/api/v1/admin/staging/progression/trigger", {
        method: "POST", cookie: elevatedCookie, csrf: elevatedCsrf,
        body: {
          confirm: "TRIGGER_PROGRESSION_EVENT", username: fixture.player.username,
          eventType: "phase6.staging.observation", idempotencyKey: firstEventKey,
          payload: { signalKey: "validation", sequence: 1 }
        }
      });
      assertCondition(first.response.status === 201, `first event returned ${first.response.status}`);
      assertCondition(first.body.progression?.eventCount === 1 && first.body.progression?.effectCount === 0, "first event should establish prior-event history without matching");
      const stored = db.database.prepare("SELECT * FROM progression_events WHERE idempotency_key = ?").get(firstEventKey);
      assertCondition(stored?.source_type === "staging_admin" && stored.account_id === fixture.player.accountId, "canonical actor/source data missing");
      assertCondition(JSON.parse(stored.payload_json).signalKey === "validation", "canonical payload missing");
      assertCondition(JSON.parse(stored.provenance_json).source === "admin_staging_trigger", "provenance missing");
      assertCondition(!!stored.request_id, "request provenance missing");
    });

    await check("elevated dry-run is non-mutating", async () => {
      const before = {
        events: db.database.prepare("SELECT COUNT(*) AS count FROM progression_events WHERE account_id = ?").get(fixture.player.accountId).count,
        history: db.database.prepare("SELECT COUNT(*) AS count FROM progression_history WHERE account_id = ?").get(fixture.player.accountId).count,
        balance: db.database.prepare("SELECT quantity FROM inventory_balances WHERE account_id = ? AND item_definition_id = ?").get(fixture.player.accountId, fixture.phase6.itemDefinitionId).quantity
      };
      const simulated = await api("/api/v1/admin/progression/simulate", {
        method: "POST", cookie: elevatedCookie, csrf: elevatedCsrf,
        body: {
          confirm: "SIMULATE_PROGRESSION", username: fixture.player.username,
          eventType: "phase6.staging.observation", payload: { signalKey: "validation", sequence: 2 }
        }
      });
      assertCondition(simulated.response.status === 200, `simulation returned ${simulated.response.status}`);
      assertCondition(simulated.body.simulation?.committed === false && simulated.body.simulation?.effectCount === 7, `simulation did not evaluate the expected consequence set (${JSON.stringify(simulated.body.simulation)})`);
      const after = {
        events: db.database.prepare("SELECT COUNT(*) AS count FROM progression_events WHERE account_id = ?").get(fixture.player.accountId).count,
        history: db.database.prepare("SELECT COUNT(*) AS count FROM progression_history WHERE account_id = ?").get(fixture.player.accountId).count,
        balance: db.database.prepare("SELECT quantity FROM inventory_balances WHERE account_id = ? AND item_definition_id = ?").get(fixture.player.accountId, fixture.phase6.itemDefinitionId).quantity
      };
      assertCondition(JSON.stringify(after) === JSON.stringify(before), "dry-run changed persistent progression state");
    });

    await check("six effects, sibling snapshot, and explicit chaining", async () => {
      const executed = await api("/api/v1/admin/staging/progression/trigger", {
        method: "POST", cookie: elevatedCookie, csrf: elevatedCsrf,
        body: {
          confirm: "TRIGGER_PROGRESSION_EVENT", username: fixture.player.username,
          eventType: "phase6.staging.observation", idempotencyKey: effectEventKey,
          payload: { signalKey: "validation", sequence: 2 }
        }
      });
      assertCondition(executed.response.status === 201, `effect event returned ${executed.response.status}`);
      assertCondition(executed.body.progression?.eventCount === 2 && executed.body.progression?.effectCount === 7, "expected root plus explicit chained event and seven effects");
      const discovery = db.database.prepare("SELECT id FROM account_discoveries WHERE account_id = ? AND discovery_key = ?").get(fixture.player.accountId, fixture.phase6.resultDiscovery);
      const balance = db.database.prepare("SELECT quantity FROM inventory_balances WHERE account_id = ? AND item_definition_id = ?").get(fixture.player.accountId, fixture.phase6.itemDefinitionId);
      const identity = db.database.prepare("SELECT clearance_state_json FROM archive_identities WHERE account_id = ?").get(fixture.player.accountId);
      const relation = db.database.prepare("SELECT status FROM account_relationship_discoveries WHERE account_id = ? AND relationship_id = ?").get(fixture.player.accountId, fixture.phase6.relationshipId);
      const state = db.database.prepare("SELECT current_state_json FROM archive_state_scopes WHERE scope_type = 'global' AND scope_key = ?").get(fixture.phase6.stateScopeKey);
      assertCondition(!!discovery && balance?.quantity === 3, "discovery or inventory effect missing");
      assertCondition(identity.clearance_state_json.includes(fixture.phase6.grantedClearance) && identity.clearance_state_json.includes(fixture.phase6.followupClearance), "clearance or chained consequence missing");
      assertCondition(!identity.clearance_state_json.includes(fixture.phase6.siblingClearance), "sibling rule observed another sibling's effect");
      assertCondition(relation?.status === "revoked" && state?.current_state_json.includes("awakened"), "relationship or Archive State effect missing");
      assertCondition(db.database.prepare("SELECT COUNT(*) AS count FROM progression_history WHERE account_id = ?").get(fixture.player.accountId).count === 7, "append-only progression history incomplete");
    });

    await check("replay and idempotency conflict", async () => {
      const replayBody = {
        confirm: "TRIGGER_PROGRESSION_EVENT", username: fixture.player.username,
        eventType: "phase6.staging.observation", idempotencyKey: effectEventKey,
        payload: { signalKey: "validation", sequence: 2 }
      };
      const replay = await api("/api/v1/admin/staging/progression/trigger", { method: "POST", cookie: elevatedCookie, csrf: elevatedCsrf, body: replayBody });
      assertCondition(replay.response.status === 200 && replay.body.progression?.duplicate === true, `replay returned ${replay.response.status}`);
      const conflict = await api("/api/v1/admin/staging/progression/trigger", { method: "POST", cookie: elevatedCookie, csrf: elevatedCsrf, body: { ...replayBody, payload: { signalKey: "validation", sequence: 3 } } });
      assertCondition(conflict.response.status === 409 && conflict.body.error?.code === "idempotency_conflict", `conflict returned ${conflict.response.status}`);
      assertCondition(db.database.prepare("SELECT quantity FROM inventory_balances WHERE account_id = ? AND item_definition_id = ?").get(fixture.player.accountId, fixture.phase6.itemDefinitionId).quantity === 3, "replay duplicated inventory effects");
    });

    await check("atomic rollback and chain limits", async () => {
      const rollbackKey = `${fixture.phase6.namespace}-rollback`;
      const rollback = await api("/api/v1/admin/staging/progression/trigger", {
        method: "POST", cookie: elevatedCookie, csrf: elevatedCsrf,
        body: { confirm: "TRIGGER_PROGRESSION_EVENT", username: fixture.player.username, eventType: "phase6.staging.rollback", idempotencyKey: rollbackKey, payload: {} }
      });
      assertCondition(rollback.response.status === 422 && rollback.body.error?.code === "progression_inventory_quantity_invalid", `rollback event returned ${rollback.response.status}`);
      assertCondition(!db.database.prepare("SELECT id FROM progression_events WHERE idempotency_key = ?").get(rollbackKey), "failed root event survived rollback");
      assertCondition(!db.database.prepare("SELECT id FROM account_discoveries WHERE account_id = ? AND discovery_key LIKE ?").get(fixture.player.accountId, `phase6.validation.must-rollback.${fixture.suffix}`), "partial discovery survived rollback");
      const chainKey = `${fixture.phase6.namespace}-chain-limit`;
      const chain = await api("/api/v1/admin/staging/progression/trigger", {
        method: "POST", cookie: elevatedCookie, csrf: elevatedCsrf,
        body: { confirm: "TRIGGER_PROGRESSION_EVENT", username: fixture.player.username, eventType: "phase6.staging.chain.1", idempotencyKey: chainKey, payload: {} }
      });
      assertCondition(chain.response.status === 422 && chain.body.error?.code === "chain_depth_limit_exceeded", `chain limit returned ${chain.response.status}`);
      assertCondition(!db.database.prepare("SELECT id FROM progression_events WHERE idempotency_key = ?").get(chainKey), "over-limit chain survived rollback");
    });

    await check("serialized concurrent writes", async () => {
      const engine = new ProgressionEngine(db, { environment: config.envName });
      const sourceSubject = `validation:${fixture.player.accountId}`;
      const shared = `${fixture.phase6.namespace}-concurrent-shared`;
      const sharedResults = await Promise.all([0, 1].map(() => engine.ingest({
        eventType: "archive.record.accessed", sourceType: "server", sourceSubject,
        accountId: fixture.player.accountId, idempotencyKey: shared,
        payload: { catalogId: "phase4-signal-001" }, provenance: { source: "staging_validation_harness" }
      })));
      assertCondition(sharedResults.filter((result) => result.duplicate).length === 1, "simultaneous replay was not deduplicated");
      await Promise.all(Array.from({ length: 12 }, (_, index) => engine.ingest({
        eventType: "archive.record.accessed", sourceType: "server", sourceSubject,
        accountId: fixture.player.accountId, idempotencyKey: `${fixture.phase6.namespace}-concurrent-${index}`,
        payload: { catalogId: "phase4-signal-001" }, provenance: { source: "staging_validation_harness" }
      })));
      const balance = db.database.prepare("SELECT quantity FROM inventory_balances WHERE account_id = ? AND item_definition_id = ?").get(fixture.player.accountId, fixture.phase6.itemDefinitionId).quantity;
      assertCondition(balance === 16, `serialized quantity expected 16, received ${balance}`);
    });

    await check("fictional and real authorization separation after progression", async () => {
      const denied = await api("/api/v1/admin/me", { cookie: playerCookie });
      assertCondition(denied.response.status === 403, "progression clearance granted real authorization");
      assertCondition(db.database.prepare("SELECT COUNT(*) AS count FROM account_roles WHERE account_id = ?").get(fixture.player.accountId).count === 0, "progression changed a real role");
    });

    await check("Phase 7 authoritative record review", async () => {
      const before = await api("/api/v1/me/state", { cookie: playerCookie });
      const internalId = await api(`/api/v1/archive/records/${fixture.phase7.reviewRecordId}/review`, {
        method: "POST", cookie: playerCookie, csrf: playerCsrf
      });
      const hidden = await api(`/api/v1/archive/records/${fixture.phase7.hiddenSlug}/review`, {
        method: "POST", cookie: playerCookie, csrf: playerCsrf
      });
      assertCondition(internalId.response.status === 404 && internalId.body.error?.code === "not_found", `internal identifier review returned ${internalId.response.status}`);
      assertCondition(hidden.response.status === 404 && hidden.body.error?.code === "not_found", `withheld slug review returned ${hidden.response.status}`);
      const reviewed = await api(`/api/v1/archive/records/${fixture.phase7.reviewSlug}/review`, {
        method: "POST", cookie: playerCookie, csrf: playerCsrf
      });
      assertCondition(reviewed.response.status === 200 && reviewed.body.review?.duplicate === false, `record review returned ${reviewed.response.status}`);
      assertCondition(reviewed.body.review?.stateChanged === true, "record review did not report visible state change");
      const event = db.database.prepare("SELECT * FROM progression_events WHERE account_id = ? AND event_type = 'archive.record.reviewed'").get(fixture.player.accountId);
      assertCondition(event?.source_type === "browser_session" && event.source_subject === fixture.player.accountId, "record review did not derive canonical actor/source");
      assertCondition(JSON.parse(event.payload_json).catalogId === fixture.phase7.reviewSlug, "record review did not derive canonical resource payload");
      assertCondition(JSON.parse(event.provenance_json).source === "authenticated_record_review" && !!event.request_id, "record review provenance was incomplete");
      const after = await api("/api/v1/me/state", { cookie: playerCookie });
      assertCondition(after.body.state.revision !== before.body.state.revision, "visible state revision did not change after review");
      assertCondition(after.body.state.revision === reviewed.body.review.stateRevision, "review receipt revision did not match projection");
      assertCondition(after.body.state.discoveries.some((entry) => entry.label === "Validation Finding"), "projected discovery missing");
      assertCondition(after.body.state.credentials.some((entry) => entry.label === "Validation Review Acknowledgement"), "projected credential missing");
      assertCondition(after.body.state.inventory.balances.some((entry) => entry.itemKey === fixture.phase7.itemKey && entry.quantity === 1), "projected inventory receipt missing");
      const projectedRelationship = after.body.state.relationships.filter((entry) =>
        entry.source?.catalogId === fixture.phase7.reviewSlug && entry.target?.catalogId === fixture.phase7.relatedSlug
      );
      assertCondition(projectedRelationship.length === 1, "intended discovered relationship was not projected exactly once");
      assertCondition(after.body.state.relationships.length === initialPhase7State.relationships.length + 1, "review exposed relationships beyond the authored discovery");
      assertCondition(after.body.state.recentReceipts.length === 4 && after.body.state.recentReceipts.length <= 12, "bounded player-safe progression receipts were incorrect");
      const projectionText = JSON.stringify(after.body.state);
      for (const forbidden of [fixture.phase7.discoveryKey, fixture.phase7.credentialKey, fixture.phase7.unknownDiscoveryKey, fixture.phase7.unknownCredentialKey, `phase7-secret-${fixture.suffix}`]) {
        assertCondition(!projectionText.includes(forbidden), `post-review projection exposed ${forbidden}`);
      }
      const revealed = await api(`/api/v1/archive/records/${fixture.phase7.reviewSlug}`, { cookie: playerCookie });
      assertCondition(revealed.body.record?.fields?.reviewFinding === "THE VALIDATION ENVELOPE REMEMBERED THE REVIEW.", "progression-driven field reveal was missing");
    });

    await check("Phase 7 review replay and OWNER parity", async () => {
      const beforeReplay = await api("/api/v1/me/state", { cookie: playerCookie });
      const replay = await api(`/api/v1/archive/records/${fixture.phase7.reviewSlug}/review`, {
        method: "POST", cookie: playerCookie, csrf: playerCsrf
      });
      const afterReplay = await api("/api/v1/me/state", { cookie: playerCookie });
      assertCondition(replay.response.status === 200 && replay.body.review?.duplicate === true && replay.body.review?.stateChanged === false, "review replay was not idempotent");
      assertCondition(afterReplay.body.state.revision === beforeReplay.body.state.revision, "replay changed visible state revision");
      const playerBalance = afterReplay.body.state.inventory.balances.find((entry) => entry.itemKey === fixture.phase7.itemKey);
      assertCondition(playerBalance?.quantity === 1, "review replay duplicated inventory");

      const adminMe = await api("/api/v1/me", { cookie: elevatedCookie });
      assertCondition(!JSON.stringify(adminMe.body).includes("owner"), "ordinary /me exposed temporary fixture OWNER role");
      for (let index = 0; index < 30; index += 1) {
        const response = await api(`/api/v1/archive/records/${fixture.phase7.reviewSlug}/review`, {
          method: "POST", cookie: elevatedCookie, csrf: elevatedCsrf
        });
        assertCondition(response.response.status === 200, `OWNER ordinary review ${index + 1} returned ${response.response.status}`);
      }
      const limited = await api(`/api/v1/archive/records/${fixture.phase7.reviewSlug}/review`, {
        method: "POST", cookie: elevatedCookie, csrf: elevatedCsrf
      });
      assertCondition(limited.response.status === 429, `OWNER received gameplay rate advantage (${limited.response.status})`);
      const ownerState = await api("/api/v1/me/state", { cookie: elevatedCookie });
      assertCondition(ownerState.response.status === 200 && !JSON.stringify(ownerState.body).includes("owner"), "player projection exposed OWNER state");
    });

    await check("Phase 7 frontend bridge boundary", async () => {
      const sourceResponse = await fetch(`${base}/js/ofa-api.js`);
      const source = await sourceResponse.text();
      assertCondition(sourceResponse.status === 200, `frontend bridge returned ${sourceResponse.status}`);
      const start = source.indexOf("let canonicalPlayerState");
      const end = source.indexOf("function pageIsPublicNormal");
      const bridge = source.slice(start, end);
      assertCondition(start >= 0 && end > start, "canonical bridge section was not found");
      assertCondition(bridge.includes('canonicalRequest("/me/state"') && bridge.includes("/review`"), "canonical bridge endpoints missing");
      for (const forbidden of ["localStorage", "oddInventory", "discoveryKey", "/me/discoveries"]) {
        assertCondition(!bridge.includes(forbidden), `canonical bridge contains forbidden client mutation/storage path ${forbidden}`);
      }
      assertCondition(bridge.includes("/investigation/start") && bridge.includes("/investigation/evidence") && bridge.includes("/attempt"), "Phase 8 typed frontend interactions were missing");
    });

    await check("Phase 8 typed investigation and evidence boundary", async () => {
      const internal = await api(`/api/v1/archive/cases/${fixture.phase8.caseRecordId}/investigation/start`, {
        method: "POST", cookie: playerCookie, csrf: playerCsrf
      });
      assertCondition(internal.response.status === 404, "internal record identity opened an investigation");
      const anonymous = await api(`/api/v1/archive/cases/${fixture.phase8.caseSlug}/investigation/start`, { method: "POST" });
      assertCondition(anonymous.response.status === 401, "anonymous investigation start was accepted");
      const started = await api(`/api/v1/archive/cases/${fixture.phase8.caseSlug}/investigation/start`, {
        method: "POST", cookie: playerCookie, csrf: playerCsrf
      });
      assertCondition(started.response.status === 200 && started.body.result?.duplicate === false, `investigation start returned ${started.response.status}`);
      const replay = await api(`/api/v1/archive/cases/${fixture.phase8.caseSlug}/investigation/start`, {
        method: "POST", cookie: playerCookie, csrf: playerCsrf
      });
      assertCondition(replay.body.result?.duplicate === true, "investigation start replay was not idempotent");
      const canonicalCount = db.database.prepare("SELECT COUNT(*) AS count FROM entity_relationships").get().count;
      const pin = await api(`/api/v1/archive/cases/${fixture.phase8.caseSlug}/investigation/evidence`, {
        method: "POST", cookie: playerCookie, csrf: playerCsrf,
        body: { targetType: "record", catalogId: fixture.phase8.evidenceSlugs[0] }
      });
      assertCondition(pin.response.status === 200 && /^evidence_/.test(pin.body.result?.evidence?.publicRef || ""), "evidence pin failed");
      assertCondition(db.database.prepare("SELECT COUNT(*) AS count FROM entity_relationships").get().count === canonicalCount, "player evidence pin mutated canonical relationships");
      const state = await api("/api/v1/me/state", { cookie: playerCookie });
      const projected = state.body.state.investigations?.find((item) => item.case.catalogId === fixture.phase8.caseSlug);
      assertCondition(projected?.evidencePins?.length === 1 && projected.steps?.length === 1, "safe investigation projection was incomplete");
      const serialized = JSON.stringify(projected);
      for (const forbidden of [fixture.phase8.answer, fixture.phase8.discoveryKey, fixture.phase8.credentialKey, fixture.phase8.relationshipId, fixture.phase8.versionId, "verifier", "condition_json"]) {
        assertCondition(!serialized.includes(forbidden), `investigation projection exposed ${forbidden}`);
      }
      const unpin = await api(`/api/v1/archive/cases/${fixture.phase8.caseSlug}/investigation/evidence/${pin.body.result.evidence.publicRef}`, {
        method: "DELETE", cookie: playerCookie, csrf: playerCsrf
      });
      assertCondition(unpin.response.status === 200, "evidence unpin failed");
    });

    await check("Phase 8 verifier neutrality and authoritative resolution", async () => {
      const endpoint = `/api/v1/archive/cases/${fixture.phase8.caseSlug}/investigation/steps/${fixture.phase8.stepKey}/attempt`;
      const wrong = await api(endpoint, { method: "POST", cookie: playerCookie, csrf: playerCsrf, body: { answer: "incorrect fixture answer" } });
      const malformed = await api(endpoint, { method: "POST", cookie: playerCookie, csrf: playerCsrf, body: { answer: 17 } });
      assertCondition(wrong.response.status === 200 && malformed.response.status === 200, "neutral wrong-answer responses diverged by status");
      assertCondition(JSON.stringify(wrong.body.result) === JSON.stringify(malformed.body.result), "malformed and wrong answers produced distinguishable result shapes");
      const before = await api("/api/v1/me/state", { cookie: playerCookie });
      const accepted = await api(endpoint, { method: "POST", cookie: playerCookie, csrf: playerCsrf, body: { answer: fixture.phase8.answer.toUpperCase() } });
      assertCondition(accepted.response.status === 200 && accepted.body.result?.accepted === true, "exact normalized answer was not accepted");
      const after = await api("/api/v1/me/state", { cookie: playerCookie });
      const investigation = after.body.state.investigations.find((item) => item.case.catalogId === fixture.phase8.caseSlug);
      assertCondition(investigation.status === "resolved" && investigation.steps[0].resolved === true, "investigation did not resolve atomically");
      assertCondition(after.body.state.revision !== before.body.state.revision, "visible investigation resolution did not change state revision");
      assertCondition(after.body.state.discoveries.some((item) => item.label === "Validation Investigation Resolution"), "Phase 8 discovery consequence missing");
      assertCondition(after.body.state.credentials.some((item) => item.label === "Validation Investigator Acknowledgement"), "Phase 8 credential consequence missing");
      assertCondition(after.body.state.inventory.balances.some((item) => item.itemKey === fixture.phase8.itemKey && item.quantity === 1), "Phase 8 inventory consequence missing");
      const event = db.database.prepare("SELECT * FROM progression_events WHERE account_id = ? AND event_type = 'archive.case.step.resolved'").get(fixture.player.accountId);
      assertCondition(event?.source_type === "interaction_service" && !!event.request_id, "trusted interaction event provenance was missing");
      const replay = await api(endpoint, { method: "POST", cookie: playerCookie, csrf: playerCsrf, body: { answer: fixture.phase8.answer } });
      const afterReplay = await api("/api/v1/me/state", { cookie: playerCookie });
      assertCondition(replay.body.result?.accepted === true && replay.body.result?.duplicate === true, "puzzle replay was not deduplicated");
      assertCondition(afterReplay.body.state.revision === after.body.state.revision, "puzzle replay changed visible state");
      const stored = JSON.stringify(db.database.prepare("SELECT input_digest, provenance_json FROM canonical_interactions WHERE account_id = ?").all(fixture.player.accountId));
      const audits = JSON.stringify(db.database.prepare("SELECT context_json FROM audit_events WHERE actor_id = ? AND action LIKE 'archive.case.%'").all(fixture.player.accountId));
      assertCondition(!stored.includes(fixture.phase8.answer) && !audits.includes(fixture.phase8.answer), "puzzle answer leaked into interaction or audit storage");
    });

    await check("Phase 8 atomic rollback, concurrency, and OWNER parity", async () => {
      const endpoint = `/api/v1/archive/cases/${fixture.phase8.caseSlug}/investigation/steps/${fixture.phase8.stepKey}/attempt`;
      const started = await api(`/api/v1/archive/cases/${fixture.phase8.caseSlug}/investigation/start`, {
        method: "POST", cookie: elevatedCookie, csrf: elevatedCsrf
      });
      assertCondition(started.response.status === 200, "OWNER ordinary investigation start failed");
      const definitions = new ProgressionDefinitionRepository(db);
      await definitions.createVersion({
        eventKey: `${fixture.phase8.namespace}.rollback`, triggerEventType: "archive.case.step.resolved",
        priority: 101, fixtureNamespace: fixture.phase8.namespace, createdBy: fixture.admin.accountId,
        condition: { event_payload: { field: "caseCatalogId", equals: fixture.phase8.caseSlug } },
        effects: [{ key: "missing", type: "inventory.quantity", config: { itemKey: `phase8_missing_${fixture.suffix}`, delta: 1 } }]
      });
      const failed = await api(endpoint, { method: "POST", cookie: elevatedCookie, csrf: elevatedCsrf, body: { answer: fixture.phase8.answer } });
      assertCondition(failed.response.status === 422, "injected effect failure did not reject the interaction");
      assertCondition(db.database.prepare("SELECT COUNT(*) AS count FROM case_investigation_attempts a JOIN account_case_investigations i ON i.id = a.account_investigation_id WHERE i.account_id = ?").get(fixture.admin.accountId).count === 0, "failed interaction retained an attempt");
      const rollbackEvent = db.database.prepare("SELECT id FROM authored_events WHERE event_key = ?").get(`${fixture.phase8.namespace}.rollback`);
      db.transaction(() => {
        db.database.prepare("DELETE FROM authored_event_version_effects WHERE definition_version_id IN (SELECT id FROM authored_event_versions WHERE authored_event_id = ?)").run(rollbackEvent.id);
        db.database.prepare("DELETE FROM authored_event_versions WHERE authored_event_id = ?").run(rollbackEvent.id);
        db.database.prepare("DELETE FROM authored_events WHERE id = ?").run(rollbackEvent.id);
      });
      const concurrent = await Promise.all([0, 1].map(() => api(endpoint, {
        method: "POST", cookie: elevatedCookie, csrf: elevatedCsrf, body: { answer: fixture.phase8.answer }
      })));
      assertCondition(concurrent.every((entry) => entry.response.status === 200 && entry.body.result?.accepted === true), "serialized concurrent puzzle attempts failed");
      assertCondition(concurrent.filter((entry) => entry.body.result?.duplicate).length === 1, "concurrent accepted attempts were not deduplicated");
      for (let index = 0; index < 9; index += 1) {
        const response = await api(endpoint, { method: "POST", cookie: elevatedCookie, csrf: elevatedCsrf, body: { answer: "owner parity replay" } });
        assertCondition(response.response.status === 200, `OWNER ordinary attempt ${index + 1} returned ${response.response.status}`);
      }
      const limited = await api(endpoint, { method: "POST", cookie: elevatedCookie, csrf: elevatedCsrf, body: { answer: "owner parity replay" } });
      assertCondition(limited.response.status === 429, `OWNER received puzzle rate advantage (${limited.response.status})`);
      assertCondition(db.database.prepare("SELECT COUNT(*) AS count FROM account_roles WHERE account_id = ?").get(fixture.player.accountId).count === 0, "fictional resolution changed real authorization");
      const published = db.database.prepare("SELECT version FROM case_investigation_versions WHERE definition_id = ? AND status = 'published'").get(fixture.phase8.definitionId);
      assertCondition(published.version === 1, "draft investigation revision displaced the published player version");
    });

    await check("Phase 7 rollout switches restored", async () => {
      for (const modeKey of ["player_surfaces_disabled", "authored_events_disabled"]) {
        const restored = await api("/api/v1/admin/operations/modes/set", {
          method: "POST", cookie: elevatedCookie, csrf: elevatedCsrf,
          body: { confirm: "SET_OPERATIONAL_MODE", modeKey, enabled: true, reason: "phase7_validation_complete_default_disabled" }
        });
        assertCondition(restored.response.status === 200, `${modeKey} restore returned ${restored.response.status}`);
      }
      db.database.prepare("UPDATE operational_modes SET enabled = 1, reason = 'phase8_default_disabled_until_physical_validation' WHERE mode_key = 'investigations_disabled'").run();
      const surfaceBlocked = await api("/api/v1/me/state", { cookie: playerCookie });
      assertCondition(surfaceBlocked.response.status === 503 && surfaceBlocked.body.error?.code === "player_surfaces_disabled", "player surface switch was not restored");
      const investigationBlocked = await api(`/api/v1/archive/cases/${fixture.phase8.caseSlug}/investigation/start`, {
        method: "POST", cookie: playerCookie, csrf: playerCsrf
      });
      assertCondition(investigationBlocked.response.status === 503 && investigationBlocked.body.error?.code === "investigations_disabled", "Phase 8 switch was not restored");
    });

    await check("privileged audit history", async () => {
      const rows = db.database.prepare("SELECT action, context_json FROM audit_events WHERE request_id LIKE ?").all(`${requestPrefix}%`);
      const actions = new Set(rows.map((row) => row.action));
      for (const action of ["admin.discovery.grant", "admin.discovery.revoke", "admin.inventory.grant", "admin.inventory.revoke", "admin.fictional_clearance.set", "admin.operations.mode.set", "admin.content.preview", "admin.progression.simulate", "admin.progression.staging_trigger", "archive.record.review", "archive.case.investigation.start", "archive.case.evidence.pin", "archive.case.step.attempt"]) {
        assertCondition(actions.has(action), `missing audit action ${action}`);
      }
      const auditText = JSON.stringify(rows);
      for (const secret of [fixture.admin.session.token, fixture.admin.session.csrfToken, fixture.player.session.token, fixture.player.session.csrfToken, elevatedCookie, elevatedCsrf]) {
        assertCondition(!auditText.includes(secret), "audit history contained reusable authentication material");
      }
      return `${rows.length} request-linked entries verified`;
    });

    report("SKIP", "emergency global session revocation", "MANUAL REQUIRED; intentionally destructive");
    report("SKIP", "privileged browser UX", "MANUAL REQUIRED");
    report("SKIP", "production-only security behavior", "MANUAL REQUIRED");
  } finally {
    if (db) {
      try {
        if (modeSnapshot.length) restoreModes(db, modeSnapshot);
      } finally {
        try {
          await cleanupValidationFixtures(db, fixture, requestPrefix);
        } finally {
          db.close();
        }
      }
    }
  }

  return results;
}

if (process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])) {
  runStagingValidation().catch((error) => {
    console.error(`FAIL            staging validation - ${error.message}`);
    process.exitCode = 1;
  });
}

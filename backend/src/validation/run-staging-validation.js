import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SQLiteD1Adapter } from "../db/sqlite-adapter.js";
import { listMigrationFiles } from "../db/migrations.js";
import { ProgressionEngine } from "../progression/engine.js";
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
        body: { confirm: "SET_CLEARANCE", clearanceState: { clearances: ["phase5.validation", "phase6.validation.prerequisite"] }, reason: "staging validation harness" }
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

    await check("privileged audit history", async () => {
      const rows = db.database.prepare("SELECT action, context_json FROM audit_events WHERE request_id LIKE ?").all(`${requestPrefix}%`);
      const actions = new Set(rows.map((row) => row.action));
      for (const action of ["admin.discovery.grant", "admin.discovery.revoke", "admin.inventory.grant", "admin.inventory.revoke", "admin.fictional_clearance.set", "admin.operations.mode.set", "admin.content.preview", "admin.progression.simulate", "admin.progression.staging_trigger"]) {
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

import { canonicalDigest, canonicalJson } from "../progression/canonical.js";
import { newId, parseJson } from "../foundation/ids.js";

export class ProgressionRepository {
  constructor(db) {
    this.db = db;
  }

  async findByIdempotency(sourceType, sourceSubject, idempotencyKey) {
    return await this.db.prepare(`
      SELECT * FROM progression_events
      WHERE source_type = ? AND source_subject = ? AND idempotency_key = ?
      LIMIT 1
    `).bind(sourceType, sourceSubject, idempotencyKey).first();
  }

  async insertEvent(event) {
    await this.db.prepare(`
      INSERT INTO progression_events (
        id, event_type, schema_version, account_id, source_type, source_subject, idempotency_key,
        payload_json, payload_digest, provenance_json, request_id, status, received_at, occurred_at,
        root_event_id, parent_event_id, chain_depth
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'processing', ?, ?, ?, ?, ?)
    `).bind(
      event.id, event.eventType, event.schemaVersion, event.accountId, event.sourceType, event.sourceSubject,
      event.idempotencyKey, canonicalJson(event.payload), event.payloadDigest, canonicalJson(event.provenance),
      event.requestId, event.receivedAt, event.occurredAt, event.rootEventId, event.parentEventId, event.chainDepth
    ).run();
  }

  async completeEvent(eventId, status, completionCode, completedAt) {
    await this.db.prepare(`
      UPDATE progression_events
      SET status = ?, completion_code = ?, completed_at = ?
      WHERE id = ?
    `).bind(status, completionCode, completedAt, eventId).run();
  }

  async snapshot(accountId, eventPayload) {
    const discoveries = new Set();
    const inventoryQuantities = new Map();
    const inventoryInstances = [];
    const clearances = new Set();
    const priorEventCounts = new Map();
    const relationships = new Set();
    const archiveStates = new Map();

    if (accountId) {
      const discoveryRows = await this.db.prepare("SELECT discovery_key FROM account_discoveries WHERE account_id = ?").bind(accountId).all();
      for (const row of discoveryRows.results || []) discoveries.add(row.discovery_key);

      const balanceRows = await this.db.prepare(`
        SELECT d.item_key, b.quantity
        FROM inventory_balances b
        JOIN inventory_item_definitions d ON d.id = b.item_definition_id
        WHERE b.account_id = ?
      `).bind(accountId).all();
      for (const row of balanceRows.results || []) inventoryQuantities.set(row.item_key, Number(row.quantity));

      const instanceRows = await this.db.prepare(`
        SELECT d.item_key, i.backend_custody_state
        FROM inventory_item_instances i
        JOIN inventory_item_definitions d ON d.id = i.item_definition_id
        WHERE i.owner_account_id = ?
      `).bind(accountId).all();
      for (const row of instanceRows.results || []) inventoryInstances.push({ itemKey: row.item_key, state: row.backend_custody_state });

      const identity = await this.db.prepare("SELECT clearance_state_json FROM archive_identities WHERE account_id = ?").bind(accountId).first();
      const clearanceState = parseJson(identity?.clearance_state_json || "{}", {});
      for (const key of clearanceState.clearances || []) clearances.add(key);
      for (const [key, value] of Object.entries(clearanceState)) if (value === true) clearances.add(key);

      const eventRows = await this.db.prepare(`
        SELECT event_type, COUNT(*) AS count
        FROM progression_events
        WHERE account_id = ? AND status IN ('completed', 'no_match')
        GROUP BY event_type
      `).bind(accountId).all();
      for (const row of eventRows.results || []) priorEventCounts.set(row.event_type, Number(row.count));

      const relationshipRows = await this.db.prepare(`
        SELECT relationship_id FROM account_relationship_discoveries
        WHERE account_id = ? AND status = 'active'
      `).bind(accountId).all();
      for (const row of relationshipRows.results || []) relationships.add(row.relationship_id);
    }

    const stateRows = await this.db.prepare("SELECT scope_type, scope_key, current_state_json FROM archive_state_scopes").all();
    for (const row of stateRows.results || []) archiveStates.set(`${row.scope_type}:${row.scope_key}`, parseJson(row.current_state_json, {}));

    const plain = {
      discoveries: [...discoveries].sort(),
      inventoryQuantities: [...inventoryQuantities.entries()].sort(([a], [b]) => a.localeCompare(b)),
      inventoryInstances: [...inventoryInstances].sort((a, b) => `${a.itemKey}:${a.state}`.localeCompare(`${b.itemKey}:${b.state}`)),
      clearances: [...clearances].sort(),
      priorEventCounts: [...priorEventCounts.entries()].sort(([a], [b]) => a.localeCompare(b)),
      relationships: [...relationships].sort(),
      archiveStates: [...archiveStates.entries()].sort(([a], [b]) => a.localeCompare(b)),
      eventPayload
    };

    return {
      discoveries,
      inventoryQuantities,
      inventoryInstances,
      clearances,
      priorEventCounts,
      relationships,
      archiveStates,
      eventPayload,
      digest: canonicalDigest(plain)
    };
  }

  async recordEvaluation({ id, eventId, definitionVersionId, matched, explanation, snapshotDigest, evaluatedAt }) {
    await this.db.prepare(`
      INSERT INTO progression_rule_evaluations (
        id, event_id, definition_version_id, matched, status, explanation_json, state_snapshot_digest, evaluated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(id, eventId, definitionVersionId, matched ? 1 : 0, matched ? "matched" : "unmatched", canonicalJson(explanation), snapshotDigest, evaluatedAt).run();
  }

  async applyEffect({ event, definition, evaluationId, effect, effectApplicationId, idempotencyKey, appliedAt }) {
    const result = await this.mutateEffect({ event, effect, effectApplicationId });
    await this.db.prepare(`
      INSERT INTO progression_effect_applications (
        id, event_id, evaluation_id, effect_definition_id, idempotency_key, effect_type,
        target_type, target_key, status, before_json, after_json, provenance_json, applied_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      effectApplicationId, event.id, evaluationId, effect.id, idempotencyKey, effect.effect_type,
      result.targetType, result.targetKey, result.changed ? "applied" : "no_change",
      canonicalJson(result.before), canonicalJson(result.after),
      canonicalJson({ source: "progression_engine", eventId: event.id, definitionVersionId: definition.id, effectKey: effect.effect_key }), appliedAt
    ).run();

    await this.db.prepare(`
      INSERT INTO progression_history (
        id, account_id, scope_type, scope_key, event_id, definition_version_id, effect_application_id,
        change_type, subject_type, subject_key, reason_json, provenance_json, player_visibility, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      newId("proghist"), event.accountId, event.accountId ? "account" : "global", event.accountId || "global",
      event.id, definition.id, effectApplicationId, effect.effect_type, result.targetType, result.targetKey,
      canonicalJson({ eventType: event.eventType, eventKey: definition.event_key, effectKey: effect.effect_key, changed: result.changed }),
      canonicalJson({ sourceType: event.sourceType, sourceSubject: event.sourceSubject, requestId: event.requestId }),
      definition.player_safe_label ? "player_safe" : "internal", appliedAt
    ).run();
    return result;
  }

  async mutateEffect({ event, effect, effectApplicationId }) {
    const config = effect.config;
    if (effect.effect_type === "discovery.set") return await this.setDiscovery(event.accountId, config, effectApplicationId);
    if (effect.effect_type === "inventory.quantity") return await this.changeInventory(event.accountId, config, effectApplicationId);
    if (effect.effect_type === "fictional_clearance.set") return await this.setClearance(event.accountId, config);
    if (effect.effect_type === "relationship.set") return await this.setRelationship(event.accountId, config, effectApplicationId);
    if (effect.effect_type === "archive_state.transition") return await this.transitionArchiveState(event, config, effectApplicationId);
    if (effect.effect_type === "event.emit") return { targetType: "event", targetKey: config.eventType, before: {}, after: { queued: true }, changed: true, emitted: config };
    throw new Error("effect_type_not_executable");
  }

  async setDiscovery(accountId, config, effectApplicationId) {
    requireAccount(accountId);
    const existing = await this.db.prepare("SELECT id FROM account_discoveries WHERE account_id = ? AND discovery_key = ?").bind(accountId, config.key).first();
    const before = !!existing;
    if (config.present && !before) {
      await this.db.prepare(`
        INSERT INTO account_discoveries (id, account_id, discovery_type, discovery_key, provenance_json)
        VALUES (?, ?, 'progression', ?, ?)
      `).bind(newId("disc"), accountId, config.key, canonicalJson({ source: "progression", effectApplicationId })).run();
    } else if (!config.present && before) {
      await this.db.prepare("DELETE FROM account_discoveries WHERE account_id = ? AND discovery_key = ?").bind(accountId, config.key).run();
    }
    return { targetType: "discovery", targetKey: config.key, before: { present: before }, after: { present: config.present }, changed: before !== config.present };
  }

  async changeInventory(accountId, config, effectApplicationId) {
    requireAccount(accountId);
    const definition = await this.db.prepare("SELECT id, stackable FROM inventory_item_definitions WHERE item_key = ?").bind(config.itemKey).first();
    if (!definition || !definition.stackable) throw new Error("progression_inventory_definition_invalid");
    const balance = await this.db.prepare("SELECT quantity FROM inventory_balances WHERE account_id = ? AND item_definition_id = ?").bind(accountId, definition.id).first();
    const before = Number(balance?.quantity || 0);
    const after = before + config.delta;
    if (!Number.isSafeInteger(after) || after < 0) throw new Error("progression_inventory_quantity_invalid");
    await this.db.prepare(`
      INSERT INTO inventory_ledger (id, account_id, item_definition_id, delta_quantity, operation, provenance_json, idempotency_key, backend_custody_change_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      newId("invled"), accountId, definition.id, config.delta,
      config.delta > 0 ? "progression_grant_quantity" : "progression_consume_quantity",
      canonicalJson({ source: "progression", effectApplicationId }), `progression:${effectApplicationId}`,
      canonicalJson({ before, after })
    ).run();
    await this.db.prepare(`
      INSERT INTO inventory_balances (account_id, item_definition_id, quantity)
      VALUES (?, ?, ?)
      ON CONFLICT(account_id, item_definition_id) DO UPDATE SET quantity = excluded.quantity, updated_at = CURRENT_TIMESTAMP
    `).bind(accountId, definition.id, after).run();
    return { targetType: "inventory", targetKey: config.itemKey, before: { quantity: before }, after: { quantity: after }, changed: config.delta !== 0 };
  }

  async setClearance(accountId, config) {
    requireAccount(accountId);
    const row = await this.db.prepare("SELECT clearance_state_json FROM archive_identities WHERE account_id = ?").bind(accountId).first();
    if (!row) throw new Error("archive_identity_not_found");
    const state = parseJson(row.clearance_state_json, {});
    const clearances = new Set(Array.isArray(state.clearances) ? state.clearances : []);
    const before = clearances.has(config.key);
    if (config.present) clearances.add(config.key);
    else clearances.delete(config.key);
    state.clearances = [...clearances].sort();
    await this.db.prepare("UPDATE archive_identities SET clearance_state_json = ?, updated_at = CURRENT_TIMESTAMP WHERE account_id = ?").bind(canonicalJson(state), accountId).run();
    return { targetType: "fictional_clearance", targetKey: config.key, before: { present: before }, after: { present: config.present }, changed: before !== config.present };
  }

  async setRelationship(accountId, config, effectApplicationId) {
    requireAccount(accountId);
    const canonical = await this.db.prepare("SELECT id FROM entity_relationships WHERE id = ? AND canonical = 1").bind(config.relationshipId).first();
    if (!canonical) throw new Error("canonical_relationship_not_found");
    const existing = await this.db.prepare("SELECT status FROM account_relationship_discoveries WHERE account_id = ? AND relationship_id = ?").bind(accountId, config.relationshipId).first();
    const before = existing?.status === "active";
    await this.db.prepare(`
      INSERT INTO account_relationship_discoveries (account_id, relationship_id, status, provenance_json, discovered_at, revoked_at)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, ?)
      ON CONFLICT(account_id, relationship_id) DO UPDATE SET
        status = excluded.status,
        provenance_json = excluded.provenance_json,
        discovered_at = CASE WHEN excluded.status = 'active' THEN CURRENT_TIMESTAMP ELSE account_relationship_discoveries.discovered_at END,
        revoked_at = excluded.revoked_at
    `).bind(
      accountId, config.relationshipId, config.present ? "active" : "revoked",
      canonicalJson({ source: "progression", effectApplicationId }), config.present ? null : new Date().toISOString()
    ).run();
    return { targetType: "relationship", targetKey: config.relationshipId, before: { present: before }, after: { present: config.present }, changed: before !== config.present };
  }

  async transitionArchiveState(event, config, effectApplicationId) {
    const existing = await this.db.prepare("SELECT * FROM archive_state_scopes WHERE scope_type = ? AND scope_key = ?").bind(config.scopeType, config.scopeKey).first();
    let scope = existing;
    if (!scope) {
      const id = newId("state");
      await this.db.prepare("INSERT INTO archive_state_scopes (id, scope_type, scope_key, current_state_json) VALUES (?, ?, ?, '{}')").bind(id, config.scopeType, config.scopeKey).run();
      scope = { id, current_state_json: "{}" };
    }
    const before = parseJson(scope.current_state_json, {});
    const after = { ...before };
    for (const [key, value] of Object.entries(config.set)) {
      if (["__proto__", "constructor", "prototype"].includes(key)) throw new Error("archive_state_key_forbidden");
      after[key] = value;
    }
    await this.db.prepare(`
      INSERT INTO archive_state_history (id, scope_id, transition_type, previous_state_json, next_state_json, cause_type, cause_id, actor_type, actor_id)
      VALUES (?, ?, ?, ?, ?, 'progression_effect', ?, ?, ?)
    `).bind(newId("statehist"), scope.id, config.transitionType, canonicalJson(before), canonicalJson(after), effectApplicationId, event.sourceType, event.accountId).run();
    await this.db.prepare("UPDATE archive_state_scopes SET current_state_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(canonicalJson(after), scope.id).run();
    return { targetType: "archive_state", targetKey: `${config.scopeType}:${config.scopeKey}`, before, after, changed: canonicalJson(before) !== canonicalJson(after) };
  }

  async eventDetail(eventId) {
    const event = await this.db.prepare("SELECT * FROM progression_events WHERE id = ?").bind(eventId).first();
    if (!event) return null;
    const evaluations = await this.db.prepare(`
      SELECT ev.*, v.version, ae.event_key
      FROM progression_rule_evaluations ev
      JOIN authored_event_versions v ON v.id = ev.definition_version_id
      JOIN authored_events ae ON ae.id = v.authored_event_id
      WHERE ev.event_id = ? ORDER BY ae.event_key
    `).bind(eventId).all();
    const effects = await this.db.prepare("SELECT * FROM progression_effect_applications WHERE event_id = ? ORDER BY applied_at, id").bind(eventId).all();
    return { event, evaluations: evaluations.results || [], effects: effects.results || [] };
  }

  async eventsForAccount(accountId, limit = 50) {
    const capped = Math.max(1, Math.min(Number(limit) || 50, 100));
    const rows = await this.db.prepare(`
      SELECT id, event_type, source_type, status, received_at, completed_at, completion_code, chain_depth
      FROM progression_events WHERE account_id = ? ORDER BY received_at DESC LIMIT ?
    `).bind(accountId, capped).all();
    return rows.results || [];
  }
}

function requireAccount(accountId) {
  if (!accountId) throw new Error("account_scoped_effect_requires_account");
}

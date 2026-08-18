import { canonicalDigest, canonicalJson } from "../progression/canonical.js";
import { eventTypeDefinition } from "../progression/event-registry.js";
import { validateEffect } from "../progression/effect-registry.js";
import { validateCondition } from "../progression/rule-evaluator.js";
import { newId, parseJson } from "../foundation/ids.js";

export class ProgressionDefinitionRepository {
  constructor(db) {
    this.db = db;
  }

  validateDefinition({ triggerEventType, condition, effects }) {
    const errors = [];
    if (!eventTypeDefinition(triggerEventType)) errors.push("trigger_event_type_unknown");
    const conditionResult = validateCondition(condition);
    errors.push(...conditionResult.errors);
    if (!Array.isArray(effects) || effects.length < 1 || effects.length > 32) errors.push("definition_effect_count_invalid");
    else {
      const keys = new Set();
      effects.forEach((effect, index) => {
        if (!effect || typeof effect !== "object" || !validKey(effect.key) || keys.has(effect.key)) errors.push(`effect_${index}_key_invalid`);
        else keys.add(effect.key);
        const result = validateEffect(effect?.type, effect?.config);
        if (!result.ok) errors.push(`effect_${index}_${result.code}`);
      });
    }
    return { ok: errors.length === 0, errors };
  }

  async createVersion({ eventKey, eventType = "progression", scopeType = "account", version = 1, triggerEventType, priority = 0, condition, effects, status = "published", fixtureNamespace = null, createdBy = null, playerSafeLabel = null, playerSafeSummary = null }) {
    const validation = this.validateDefinition({ triggerEventType, condition, effects });
    if (!validation.ok) throw new Error(`invalid_progression_definition:${validation.errors.join(",")}`);
    const eventId = newId("aevent");
    const versionId = newId("aeventv");
    const checksum = canonicalDigest({ triggerEventType, priority, condition, effects });
    const publishedAt = status === "published" ? new Date().toISOString() : null;
    await this.db.withTransaction(async (tx) => {
      await tx.prepare(`
        INSERT INTO authored_events (id, event_key, event_type, scope_type, status)
        VALUES (?, ?, ?, ?, ?)
      `).bind(eventId, eventKey, eventType, scopeType, status === "published" ? "active" : "draft").run();
      await tx.prepare(`
        INSERT INTO authored_event_versions (
          id, authored_event_id, version, trigger_event_type, status, priority, condition_json,
          definition_checksum, player_safe_label, player_safe_summary, fixture_namespace,
          created_by, published_by, published_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        versionId, eventId, version, triggerEventType, status, priority, canonicalJson(condition), checksum,
        playerSafeLabel, playerSafeSummary, fixtureNamespace, createdBy, status === "published" ? createdBy : null, publishedAt
      ).run();
      for (let index = 0; index < effects.length; index += 1) {
        const effect = effects[index];
        await tx.prepare(`
          INSERT INTO authored_event_version_effects (id, definition_version_id, effect_key, effect_order, effect_type, effect_json)
          VALUES (?, ?, ?, ?, ?, ?)
        `).bind(newId("aefx"), versionId, effect.key, index, effect.type, canonicalJson(effect.config)).run();
      }
    });
    return { eventId, versionId, checksum };
  }

  async publishedForTrigger(triggerEventType) {
    const rows = await this.db.prepare(`
      SELECT v.*, e.event_key
      FROM authored_event_versions v
      JOIN authored_events e ON e.id = v.authored_event_id
      WHERE v.trigger_event_type = ? AND v.status = 'published' AND e.status = 'active'
      ORDER BY v.priority DESC, e.event_key ASC, v.version ASC
    `).bind(triggerEventType).all();
    const out = [];
    for (const row of rows.results || []) {
      const effects = await this.effects(row.id);
      out.push({
        ...row,
        condition: parseJson(row.condition_json, {}),
        effects
      });
    }
    return out;
  }

  async effects(versionId) {
    const rows = await this.db.prepare(`
      SELECT * FROM authored_event_version_effects
      WHERE definition_version_id = ?
      ORDER BY effect_order ASC
    `).bind(versionId).all();
    return (rows.results || []).map((row) => ({ ...row, config: parseJson(row.effect_json, {}) }));
  }

  async list() {
    const rows = await this.db.prepare(`
      SELECT e.id, e.event_key, e.event_type, e.scope_type, e.status,
        v.id AS version_id, v.version, v.trigger_event_type, v.priority, v.definition_checksum,
        v.player_safe_label, v.player_safe_summary, v.published_at
      FROM authored_events e
      JOIN authored_event_versions v ON v.authored_event_id = e.id
      ORDER BY e.event_key, v.version DESC
    `).all();
    return rows.results || [];
  }

  async byEventKey(eventKey) {
    const rows = await this.db.prepare(`
      SELECT e.id AS authored_event_id, e.event_key, e.event_type, e.scope_type, e.status AS event_status,
        v.*
      FROM authored_events e
      JOIN authored_event_versions v ON v.authored_event_id = e.id
      WHERE e.event_key = ?
      ORDER BY v.version DESC
    `).bind(eventKey).all();
    const versions = [];
    for (const row of rows.results || []) {
      versions.push({
        ...row,
        condition: parseJson(row.condition_json, {}),
        effects: await this.effects(row.id)
      });
    }
    return versions;
  }
}

function validKey(value) {
  return typeof value === "string" && value.length >= 1 && value.length <= 128 && /^[A-Za-z0-9._:-]+$/.test(value);
}

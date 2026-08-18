import { jsonString, newId, parseJson } from "../foundation/ids.js";

export class ArchiveStateRepository {
  constructor(db) {
    this.db = db;
  }

  async getOrCreateScope(scopeType, scopeKey, initialState = {}) {
    const existing = await this.db.prepare("SELECT * FROM archive_state_scopes WHERE scope_type = ? AND scope_key = ?").bind(scopeType, scopeKey).first();
    if (existing) return existing;
    const id = newId("state");
    await this.db.prepare(`
      INSERT INTO archive_state_scopes (id, scope_type, scope_key, current_state_json)
      VALUES (?, ?, ?, ?)
    `).bind(id, scopeType, scopeKey, jsonString(initialState)).run();
    return await this.db.prepare("SELECT * FROM archive_state_scopes WHERE id = ?").bind(id).first();
  }

  async transition({ scopeType, scopeKey, transitionType, nextState, causeType, causeId = null, actorType = null, actorId = null }) {
    const scope = await this.getOrCreateScope(scopeType, scopeKey);
    const historyId = newId("statehist");
    const previousState = parseJson(scope.current_state_json, {});
    await this.db.withTransaction(async (tx) => {
      await tx.prepare(`
        INSERT INTO archive_state_history (id, scope_id, transition_type, previous_state_json, next_state_json, cause_type, cause_id, actor_type, actor_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(historyId, scope.id, transitionType, jsonString(previousState), jsonString(nextState), causeType, causeId, actorType, actorId).run();
      await tx.prepare(`
        UPDATE archive_state_scopes SET current_state_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
      `).bind(jsonString(nextState), scope.id).run();
    });
    return historyId;
  }

  async history(scopeType, scopeKey) {
    const scope = await this.db.prepare("SELECT id FROM archive_state_scopes WHERE scope_type = ? AND scope_key = ?").bind(scopeType, scopeKey).first();
    if (!scope) return [];
    const rows = await this.db.prepare("SELECT * FROM archive_state_history WHERE scope_id = ? ORDER BY created_at").bind(scope.id).all();
    return rows.results || [];
  }
}

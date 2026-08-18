import { jsonString, newId } from "../foundation/ids.js";

export class PlayerStateRepository {
  constructor(db) {
    this.db = db;
  }

  async setPrivateState(accountId, key, value) {
    await this.db.prepare(`
      INSERT INTO account_private_state (account_id, state_key, value_json)
      VALUES (?, ?, ?)
      ON CONFLICT(account_id, state_key) DO UPDATE SET value_json = excluded.value_json, updated_at = CURRENT_TIMESTAMP
    `).bind(accountId, key, jsonString(value)).run();
  }

  async getPrivateState(accountId, key) {
    return await this.db.prepare("SELECT state_key, value_json FROM account_private_state WHERE account_id = ? AND state_key = ?").bind(accountId, key).first();
  }

  async addDiscovery({ accountId, discoveryType, discoveryKey, resourceType = null, resourceId = null, provenance = {} }) {
    const id = newId("disc");
    await this.db.prepare(`
      INSERT OR IGNORE INTO account_discoveries (id, account_id, discovery_type, discovery_key, resource_type, resource_id, provenance_json)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(id, accountId, discoveryType, discoveryKey, resourceType, resourceId, jsonString(provenance)).run();
    return id;
  }

  async discoveries(accountId) {
    const rows = await this.db.prepare(`
      SELECT discovery_type, discovery_key, resource_type, resource_id, discovered_at
      FROM account_discoveries
      WHERE account_id = ?
      ORDER BY discovered_at DESC
    `).bind(accountId).all();
    return rows.results || [];
  }
}


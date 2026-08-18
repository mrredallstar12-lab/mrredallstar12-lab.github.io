import { parseJson } from "../foundation/ids.js";

export class MeInventoryRepository {
  constructor(db) {
    this.db = db;
  }

  async list(accountId) {
    const balances = await this.db.prepare(`
      SELECT d.item_key, d.name, d.item_type, d.stackable, d.metadata_public_json, b.quantity, b.updated_at
      FROM inventory_balances b
      JOIN inventory_item_definitions d ON d.id = b.item_definition_id
      WHERE b.account_id = ? AND b.quantity > 0
      ORDER BY d.name
    `).bind(accountId).all();
    const instances = await this.db.prepare(`
      SELECT i.id, d.item_key, d.name, d.item_type, d.metadata_public_json, i.backend_custody_state, i.fictional_custody_json, i.state_json, i.updated_at
      FROM inventory_item_instances i
      JOIN inventory_item_definitions d ON d.id = i.item_definition_id
      WHERE i.owner_account_id = ?
      ORDER BY i.created_at DESC
    `).bind(accountId).all();
    return {
      balances: (balances.results || []).map((row) => ({
        itemKey: row.item_key,
        name: row.name,
        itemType: row.item_type,
        stackable: !!row.stackable,
        publicMetadata: parseJson(row.metadata_public_json, {}),
        quantity: Number(row.quantity || 0),
        updatedAt: row.updated_at
      })),
      instances: (instances.results || []).map((row) => ({
        instanceRef: row.id,
        itemKey: row.item_key,
        name: row.name,
        itemType: row.item_type,
        publicMetadata: parseJson(row.metadata_public_json, {}),
        backendCustodyState: row.backend_custody_state,
        fictionalCustody: parseJson(row.fictional_custody_json, {}),
        state: parseJson(row.state_json, {}),
        updatedAt: row.updated_at
      }))
    };
  }
}


import { jsonString, newId } from "../foundation/ids.js";

export class InventoryRepository {
  constructor(db) {
    this.db = db;
  }

  async createDefinition({ itemKey, name, itemType, stackable = false, publicMetadata = {}, secretMetadata = {}, steamMapping = {} }) {
    const id = newId("itemdef");
    await this.db.prepare(`
      INSERT INTO inventory_item_definitions (id, item_key, name, item_type, stackable, metadata_public_json, metadata_secret_json, steam_mapping_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(id, itemKey, name, itemType, stackable ? 1 : 0, jsonString(publicMetadata), jsonString(secretMetadata), jsonString(steamMapping)).run();
    return id;
  }

  async grantQuantity({ accountId, itemDefinitionId, quantity, provenance, idempotencyKey, fictionalCustodyEvent = {} }) {
    if (!idempotencyKey) throw new Error("idempotency_key_required");
    const existing = await this.db.prepare("SELECT id FROM inventory_ledger WHERE account_id = ? AND idempotency_key = ?").bind(accountId, idempotencyKey).first();
    if (existing) return { id: existing.id, idempotent: true };
    const id = newId("invled");
    await this.db.transaction(() => {
      this.db.database.prepare(`
        INSERT INTO inventory_ledger (id, account_id, item_definition_id, delta_quantity, operation, provenance_json, idempotency_key, fictional_custody_event_json)
        VALUES (?, ?, ?, ?, 'grant_quantity', ?, ?, ?)
      `).run(id, accountId, itemDefinitionId, quantity, jsonString(provenance), idempotencyKey, jsonString(fictionalCustodyEvent));
      this.db.database.prepare(`
        INSERT INTO inventory_balances (account_id, item_definition_id, quantity)
        VALUES (?, ?, ?)
        ON CONFLICT(account_id, item_definition_id) DO UPDATE SET
          quantity = quantity + excluded.quantity,
          updated_at = CURRENT_TIMESTAMP
      `).run(accountId, itemDefinitionId, quantity);
    });
    return { id, idempotent: false };
  }

  async createInstance({ accountId, itemDefinitionId, provenance, idempotencyKey, state = {}, backendCustodyState = "held", fictionalCustody = {} }) {
    if (!idempotencyKey) throw new Error("idempotency_key_required");
    const existing = await this.db.prepare("SELECT item_instance_id FROM inventory_ledger WHERE account_id = ? AND idempotency_key = ?").bind(accountId, idempotencyKey).first();
    if (existing) return { id: existing.item_instance_id, idempotent: true };
    const instanceId = newId("iteminst");
    const ledgerId = newId("invled");
    await this.db.transaction(() => {
      this.db.database.prepare(`
        INSERT INTO inventory_item_instances (id, item_definition_id, owner_account_id, backend_custody_state, fictional_custody_json, state_json)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(instanceId, itemDefinitionId, accountId, backendCustodyState, jsonString(fictionalCustody), jsonString(state));
      this.db.database.prepare(`
        INSERT INTO inventory_ledger (id, account_id, item_definition_id, item_instance_id, operation, provenance_json, idempotency_key, backend_custody_change_json, fictional_custody_event_json)
        VALUES (?, ?, ?, ?, 'grant_instance', ?, ?, ?, ?)
      `).run(ledgerId, accountId, itemDefinitionId, instanceId, jsonString(provenance), idempotencyKey, jsonString({ state: backendCustodyState }), jsonString(fictionalCustody));
      this.db.database.prepare(`
        INSERT INTO inventory_item_history (id, item_instance_id, event_type, event_json)
        VALUES (?, ?, 'created', ?)
      `).run(newId("ihist"), instanceId, jsonString({ provenance }));
    });
    return { id: instanceId, idempotent: false };
  }

  async balance(accountId, itemDefinitionId) {
    const row = await this.db.prepare("SELECT quantity FROM inventory_balances WHERE account_id = ? AND item_definition_id = ?").bind(accountId, itemDefinitionId).first();
    return Number(row?.quantity || 0);
  }
}


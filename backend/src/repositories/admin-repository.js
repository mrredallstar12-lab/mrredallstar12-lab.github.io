import { jsonString, newId, parseJson } from "../foundation/ids.js";

export class AdminRepository {
  constructor(db) {
    this.db = db;
  }

  async roles(accountId) {
    const rows = await this.db.prepare(`
      SELECT r.role_key, r.label
      FROM account_roles ar
      JOIN roles r ON r.id = ar.role_id
      WHERE ar.account_id = ? AND ar.revoked_at IS NULL
      ORDER BY r.role_key
    `).bind(accountId).all();
    return rows.results || [];
  }

  async permissions(accountId) {
    const rows = await this.db.prepare(`
      SELECT DISTINCT p.permission_key
      FROM account_roles ar
      JOIN roles r ON r.id = ar.role_id
      JOIN role_permissions rp ON rp.role_id = r.id
      JOIN permissions p ON p.id = rp.permission_id
      WHERE ar.account_id = ? AND ar.revoked_at IS NULL
      ORDER BY p.permission_key
    `).bind(accountId).all();
    return (rows.results || []).map((row) => row.permission_key);
  }

  async playerByUsername(username) {
    return await this.db.prepare(`
      SELECT a.id, a.status, a.created_at, a.updated_at,
        p.username_display, p.username_normalized,
        ai.designation AS archive_designation, ai.clearance_state_json
      FROM accounts a
      JOIN account_profiles p ON p.account_id = a.id
      LEFT JOIN archive_identities ai ON ai.account_id = a.id
      WHERE p.username_normalized = ?
      LIMIT 1
    `).bind(String(username || "").trim().toLowerCase()).first();
  }

  async playerById(accountId) {
    return await this.db.prepare(`
      SELECT a.id, a.status, a.created_at, a.updated_at,
        p.username_display, p.username_normalized,
        ai.designation AS archive_designation, ai.clearance_state_json
      FROM accounts a
      JOIN account_profiles p ON p.account_id = a.id
      LEFT JOIN archive_identities ai ON ai.account_id = a.id
      WHERE a.id = ?
      LIMIT 1
    `).bind(accountId).first();
  }

  async playerSnapshot(accountId) {
    const account = await this.playerById(accountId);
    if (!account) return null;
    const discoveries = await this.db.prepare(`
      SELECT discovery_type, discovery_key, resource_type, resource_id, discovered_at, provenance_json
      FROM account_discoveries
      WHERE account_id = ?
      ORDER BY discovered_at DESC
    `).bind(accountId).all();
    const sessions = await this.db.prepare(`
      SELECT id, status, issued_at, expires_at, revoked_at, revocation_reason, last_seen_at
      FROM sessions
      WHERE account_id = ?
      ORDER BY issued_at DESC
      LIMIT 20
    `).bind(accountId).all();
    const relationships = await this.db.prepare(`
      SELECT source_type, source_id, relationship_type, target_type, target_id, confidence, created_at
      FROM account_relationships
      WHERE account_id = ?
      ORDER BY created_at DESC
      LIMIT 50
    `).bind(accountId).all();
    return {
      account: adminAccount(account),
      discoveries: (discoveries.results || []).map((row) => ({ ...row, provenance: parseJson(row.provenance_json, {}) })),
      sessions: sessions.results || [],
      relationships: relationships.results || []
    };
  }

  async activeElevation(sessionId) {
    const row = await this.db.prepare(`
      SELECT *
      FROM admin_elevations
      WHERE session_id = ?
        AND status = 'active'
        AND revoked_at IS NULL
      ORDER BY issued_at DESC
      LIMIT 1
    `).bind(sessionId).first();
    if (!row || Date.parse(row.expires_at) <= Date.now()) return null;
    return row;
  }

  async createElevation({ sessionId, accountId, ttlSeconds = 600, requestId = null, reason = "fresh_auth" }) {
    const id = newId("admelv");
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
    await this.db.prepare(`
      INSERT INTO admin_elevations (id, session_id, account_id, expires_at, request_id, reason)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(id, sessionId, accountId, expiresAt, requestId, reason).run();
    return { id, expiresAt };
  }

  async inventoryLedger(accountId, limit = 100) {
    const capped = Math.max(1, Math.min(Number(limit || 100), 200));
    const rows = await this.db.prepare(`
      SELECT l.id, l.operation, l.delta_quantity, l.idempotency_key, l.provenance_json,
        l.backend_custody_change_json, l.fictional_custody_event_json, l.created_at,
        d.item_key, d.name, l.item_instance_id
      FROM inventory_ledger l
      LEFT JOIN inventory_item_definitions d ON d.id = l.item_definition_id
      WHERE l.account_id = ?
      ORDER BY l.created_at DESC
      LIMIT ?
    `).bind(accountId, capped).all();
    return (rows.results || []).map((row) => ({
      id: row.id,
      operation: row.operation,
      itemKey: row.item_key,
      itemName: row.name,
      itemInstanceId: row.item_instance_id,
      deltaQuantity: row.delta_quantity,
      idempotencyKey: row.idempotency_key,
      provenance: parseJson(row.provenance_json, {}),
      backendCustodyChange: parseJson(row.backend_custody_change_json, {}),
      fictionalCustodyEvent: parseJson(row.fictional_custody_event_json, {}),
      createdAt: row.created_at
    }));
  }

  async grantDiscovery({ accountId, discoveryType, discoveryKey, actorId, reason = "", resourceType = null, resourceId = null }) {
    const id = newId("disc");
    await this.db.prepare(`
      INSERT OR IGNORE INTO account_discoveries (id, account_id, discovery_type, discovery_key, resource_type, resource_id, provenance_json)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(id, accountId, discoveryType, discoveryKey, resourceType, resourceId, jsonString({ source: "admin", actorId, reason })).run();
    return id;
  }

  async revokeDiscovery({ accountId, discoveryType, discoveryKey }) {
    const result = await this.db.prepare(`
      DELETE FROM account_discoveries
      WHERE account_id = ? AND discovery_type = ? AND discovery_key = ?
    `).bind(accountId, discoveryType, discoveryKey).run();
    return result.meta?.changes || 0;
  }

  async setClearance({ accountId, clearanceState }) {
    await this.db.prepare(`
      UPDATE archive_identities
      SET clearance_state_json = ?, updated_at = CURRENT_TIMESTAMP
      WHERE account_id = ?
    `).bind(jsonString(clearanceState), accountId).run();
  }

  async revokeAccountSessions({ accountId, reason = "admin_revoke_account_sessions", exceptSessionId = null }) {
    const result = exceptSessionId
      ? await this.db.prepare(`
        UPDATE sessions
        SET status = 'revoked', revoked_at = CURRENT_TIMESTAMP, revocation_reason = ?
        WHERE account_id = ? AND revoked_at IS NULL AND id <> ?
      `).bind(reason, accountId, exceptSessionId).run()
      : await this.db.prepare(`
        UPDATE sessions
        SET status = 'revoked', revoked_at = CURRENT_TIMESTAMP, revocation_reason = ?
        WHERE account_id = ? AND revoked_at IS NULL
      `).bind(reason, accountId).run();
    return result.meta?.changes || 0;
  }

  async revokeGlobalSessions({ reason = "admin_global_revoke", exceptSessionId }) {
    const result = await this.db.prepare(`
      UPDATE sessions
      SET status = 'revoked', revoked_at = CURRENT_TIMESTAMP, revocation_reason = ?
      WHERE revoked_at IS NULL AND id <> ?
    `).bind(reason, exceptSessionId).run();
    return result.meta?.changes || 0;
  }

  async ensureItemDefinition({ itemKey, name, itemType = "admin-grant", stackable = true }) {
    const existing = await this.db.prepare("SELECT id, stackable FROM inventory_item_definitions WHERE item_key = ?").bind(itemKey).first();
    if (existing) return existing;
    const id = newId("itemdef");
    await this.db.prepare(`
      INSERT INTO inventory_item_definitions (id, item_key, name, item_type, stackable, metadata_public_json, metadata_secret_json, steam_mapping_json)
      VALUES (?, ?, ?, ?, ?, '{}', '{}', '{}')
    `).bind(id, itemKey, name, itemType, stackable ? 1 : 0).run();
    return { id, stackable: stackable ? 1 : 0 };
  }

  async findItemDefinition(itemKey) {
    return await this.db.prepare("SELECT id, stackable FROM inventory_item_definitions WHERE item_key = ?").bind(itemKey).first();
  }

  async revokeQuantity({ accountId, itemDefinitionId, quantity, actorId, reason, idempotencyKey }) {
    const current = await this.db.prepare("SELECT quantity FROM inventory_balances WHERE account_id = ? AND item_definition_id = ?").bind(accountId, itemDefinitionId).first();
    const before = Number(current?.quantity || 0);
    if (quantity <= 0 || before - quantity < 0) throw new Error("invalid_inventory_quantity");
    const ledgerId = newId("invled");
    await this.db.transaction(() => {
      this.db.database.prepare(`
        UPDATE inventory_balances
        SET quantity = quantity - ?, updated_at = CURRENT_TIMESTAMP
        WHERE account_id = ? AND item_definition_id = ?
      `).run(quantity, accountId, itemDefinitionId);
      this.db.database.prepare(`
        INSERT INTO inventory_ledger (id, account_id, item_definition_id, delta_quantity, operation, provenance_json, idempotency_key, backend_custody_change_json)
        VALUES (?, ?, ?, ?, 'admin_revoke_quantity', ?, ?, ?)
      `).run(ledgerId, accountId, itemDefinitionId, -quantity, jsonString({ source: "admin", actorId, reason }), idempotencyKey, jsonString({ before, after: before - quantity }));
    });
    return { id: ledgerId, before, after: before - quantity };
  }

  async revokeInstanceCustody({ accountId, itemInstanceId, actorId, reason, idempotencyKey }) {
    const instance = await this.db.prepare(`
      SELECT id, item_definition_id, backend_custody_state
      FROM inventory_item_instances
      WHERE id = ? AND owner_account_id = ?
      LIMIT 1
    `).bind(itemInstanceId, accountId).first();
    if (!instance) throw new Error("item_instance_not_found");
    const ledgerId = newId("invled");
    await this.db.transaction(() => {
      this.db.database.prepare(`
        UPDATE inventory_item_instances
        SET backend_custody_state = 'revoked', updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(itemInstanceId);
      this.db.database.prepare(`
        INSERT INTO inventory_ledger (id, account_id, item_definition_id, item_instance_id, operation, provenance_json, idempotency_key, backend_custody_change_json)
        VALUES (?, ?, ?, ?, 'admin_revoke_instance', ?, ?, ?)
      `).run(ledgerId, accountId, instance.item_definition_id, itemInstanceId, jsonString({ source: "admin", actorId, reason }), idempotencyKey, jsonString({ before: instance.backend_custody_state, after: "revoked" }));
      this.db.database.prepare(`
        INSERT INTO inventory_item_history (id, item_instance_id, event_type, event_json)
        VALUES (?, ?, 'admin_custody_revoked', ?)
      `).run(newId("ihist"), itemInstanceId, jsonString({ actorId, reason }));
    });
    return { id: ledgerId, itemInstanceId, before: instance.backend_custody_state, after: "revoked" };
  }
}

export function adminAccount(row) {
  return {
    id: row.id,
    status: row.status,
    username: row.username_display,
    usernameNormalized: row.username_normalized,
    archiveIdentity: {
      designation: row.archive_designation,
      clearanceState: parseJson(row.clearance_state_json || "{}", {})
    },
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

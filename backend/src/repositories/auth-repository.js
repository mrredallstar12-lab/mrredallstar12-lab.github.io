import { newId, jsonString } from "../foundation/ids.js";
import { createOpaqueSessionToken, digestSessionToken } from "../security/session-tokens.js";

export class AuthRepository {
  constructor(db, options = {}) {
    this.db = db;
    this.sessionPepper = options.sessionPepper || "";
  }

  async createAccount({ status = "active" } = {}) {
    const id = newId("acct");
    await this.db.prepare("INSERT INTO accounts (id, status) VALUES (?, ?)").bind(id, status).run();
    return { id, status };
  }

  async addExternalIdentity({ accountId, provider, providerSubject, emailDigest = null, metadata = {} }) {
    const id = newId("extid");
    await this.db.prepare(`
      INSERT INTO external_identities (id, account_id, provider, provider_subject, email_digest, metadata_json)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(id, accountId, provider, providerSubject, emailDigest, jsonString(metadata)).run();
    return id;
  }

  async createArchiveIdentity({ accountId, designation, clearanceState = {} }) {
    const id = newId("archid");
    await this.db.prepare(`
      INSERT INTO archive_identities (id, account_id, designation, clearance_state_json)
      VALUES (?, ?, ?, ?)
    `).bind(id, accountId, designation, jsonString(clearanceState)).run();
    return id;
  }

  async createSession({ accountId = null, ttlSeconds = 3600, metadata = {} } = {}) {
    const id = newId("sess");
    const token = createOpaqueSessionToken();
    const digest = digestSessionToken(token, this.sessionPepper);
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
    await this.db.prepare(`
      INSERT INTO sessions (id, account_id, token_digest, expires_at, metadata_json)
      VALUES (?, ?, ?, ?, ?)
    `).bind(id, accountId, digest, expiresAt, jsonString(metadata)).run();
    return { id, token, expiresAt };
  }

  async findActiveSessionByToken(token) {
    const digest = digestSessionToken(token, this.sessionPepper);
    const row = await this.db.prepare(`
      SELECT * FROM sessions
      WHERE token_digest = ? AND status = 'active' AND revoked_at IS NULL
      LIMIT 1
    `).bind(digest).first();
    if (row && Date.parse(row.expires_at) <= Date.now()) return null;
    if (row) {
      await this.db.prepare("UPDATE sessions SET last_seen_at = CURRENT_TIMESTAMP WHERE id = ?").bind(row.id).run();
    }
    return row || null;
  }

  async revokeSession(sessionId, reason = "revoked") {
    await this.db.prepare(`
      UPDATE sessions SET status = 'revoked', revoked_at = CURRENT_TIMESTAMP, revocation_reason = ?
      WHERE id = ?
    `).bind(reason, sessionId).run();
  }

  async createRole(roleKey, label, description = "") {
    const id = newId("role");
    await this.db.prepare("INSERT INTO roles (id, role_key, label, description) VALUES (?, ?, ?, ?)").bind(id, roleKey, label, description).run();
    return id;
  }

  async createPermission(permissionKey, description = "") {
    const id = newId("perm");
    await this.db.prepare("INSERT INTO permissions (id, permission_key, description) VALUES (?, ?, ?)").bind(id, permissionKey, description).run();
    return id;
  }

  async grantPermissionToRole(roleKey, permissionKey) {
    const role = await this.db.prepare("SELECT id FROM roles WHERE role_key = ?").bind(roleKey).first();
    const permission = await this.db.prepare("SELECT id FROM permissions WHERE permission_key = ?").bind(permissionKey).first();
    if (!role || !permission) throw new Error("role_or_permission_not_found");
    await this.db.prepare("INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)").bind(role.id, permission.id).run();
  }

  async grantRole(accountId, roleKey, scope = "global", grantedBy = null) {
    const role = await this.db.prepare("SELECT id FROM roles WHERE role_key = ?").bind(roleKey).first();
    if (!role) throw new Error("role_not_found");
    await this.db.prepare(`
      INSERT OR REPLACE INTO account_roles (account_id, role_id, scope, granted_by, revoked_at)
      VALUES (?, ?, ?, ?, NULL)
    `).bind(accountId, role.id, scope, grantedBy).run();
  }

  async hasPermission(accountId, permissionKey, scope = "global") {
    const row = await this.db.prepare(`
      SELECT 1 AS allowed
      FROM account_roles ar
      JOIN roles r ON r.id = ar.role_id
      JOIN role_permissions rp ON rp.role_id = r.id
      JOIN permissions p ON p.id = rp.permission_id
      WHERE ar.account_id = ?
        AND ar.revoked_at IS NULL
        AND (ar.scope = ? OR ar.scope = 'global')
        AND p.permission_key = ?
      LIMIT 1
    `).bind(accountId, scope, permissionKey).first();
    return !!row;
  }
}

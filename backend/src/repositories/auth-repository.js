import { newId, jsonString } from "../foundation/ids.js";
import { createOpaqueSessionToken, digestSessionToken } from "../security/session-tokens.js";
import { createCsrfToken, digestCsrfToken } from "../security/http.js";

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
    const csrfToken = createCsrfToken();
    const csrfDigest = digestCsrfToken(csrfToken, this.sessionPepper);
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
    await this.db.transaction(() => {
      this.db.database.prepare(`
        INSERT INTO sessions (id, account_id, token_digest, expires_at, metadata_json)
        VALUES (?, ?, ?, ?, ?)
      `).run(id, accountId, digest, expiresAt, jsonString(metadata));
      this.db.database.prepare(`
        INSERT INTO session_csrf_tokens (session_id, token_digest)
        VALUES (?, ?)
      `).run(id, csrfDigest);
    });
    return { id, token, csrfToken, expiresAt };
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

  async revokeAllAccountSessions(accountId, reason = "revoked_all") {
    await this.db.prepare(`
      UPDATE sessions SET status = 'revoked', revoked_at = CURRENT_TIMESTAMP, revocation_reason = ?
      WHERE account_id = ? AND revoked_at IS NULL
    `).bind(reason, accountId).run();
  }

  async verifyCsrf(sessionId, csrfToken) {
    const row = await this.db.prepare("SELECT token_digest FROM session_csrf_tokens WHERE session_id = ?").bind(sessionId).first();
    if (!row || !csrfToken) return false;
    return row.token_digest === digestCsrfToken(csrfToken, this.sessionPepper);
  }

  async rotateCsrf(sessionId) {
    const csrfToken = createCsrfToken();
    const csrfDigest = digestCsrfToken(csrfToken, this.sessionPepper);
    await this.db.prepare(`
      INSERT INTO session_csrf_tokens (session_id, token_digest)
      VALUES (?, ?)
      ON CONFLICT(session_id) DO UPDATE SET token_digest = excluded.token_digest, created_at = CURRENT_TIMESTAMP
    `).bind(sessionId, csrfDigest).run();
    return csrfToken;
  }

  async createEmailChallenge({ purpose, emailDigest, accountId = null, ttlSeconds = 900, requestId = null }) {
    const id = newId("emailtok");
    const token = createOpaqueSessionToken();
    const tokenDigest = digestSessionToken(`${purpose}:${token}`, this.sessionPepper);
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
    await this.db.prepare(`
      INSERT INTO auth_email_challenges (id, purpose, email_digest, account_id, token_digest, expires_at, request_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(id, purpose, emailDigest, accountId, tokenDigest, expiresAt, requestId).run();
    return { id, token, expiresAt };
  }

  async consumeEmailChallenge({ purpose, token }) {
    const tokenDigest = digestSessionToken(`${purpose}:${token}`, this.sessionPepper);
    const row = await this.db.prepare(`
      SELECT * FROM auth_email_challenges
      WHERE token_digest = ? AND purpose = ? AND status = 'active' AND consumed_at IS NULL AND revoked_at IS NULL
      LIMIT 1
    `).bind(tokenDigest, purpose).first();
    if (!row) return null;
    if (Date.parse(row.expires_at) <= Date.now()) return null;
    await this.db.prepare(`
      UPDATE auth_email_challenges SET status = 'consumed', consumed_at = CURRENT_TIMESTAMP WHERE id = ?
    `).bind(row.id).run();
    return row;
  }

  async revokeEmailChallenge(challengeId) {
    await this.db.prepare(`
      UPDATE auth_email_challenges SET status = 'revoked', revoked_at = CURRENT_TIMESTAMP WHERE id = ? AND consumed_at IS NULL
    `).bind(challengeId).run();
  }

  async createRole(roleKey, label, description = "") {
    const existing = await this.db.prepare("SELECT id FROM roles WHERE role_key = ?").bind(roleKey).first();
    if (existing) return existing.id;
    const id = newId("role");
    await this.db.prepare("INSERT INTO roles (id, role_key, label, description) VALUES (?, ?, ?, ?)").bind(id, roleKey, label, description).run();
    return id;
  }

  async createPermission(permissionKey, description = "") {
    const existing = await this.db.prepare("SELECT id FROM permissions WHERE permission_key = ?").bind(permissionKey).first();
    if (existing) return existing.id;
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

  async hasRole(accountId, roleKey, scope = "global") {
    const row = await this.db.prepare(`
      SELECT 1 AS allowed
      FROM account_roles ar
      JOIN roles r ON r.id = ar.role_id
      WHERE ar.account_id = ?
        AND ar.revoked_at IS NULL
        AND (ar.scope = ? OR ar.scope = 'global')
        AND r.role_key = ?
      LIMIT 1
    `).bind(accountId, scope, roleKey).first();
    return !!row;
  }
}

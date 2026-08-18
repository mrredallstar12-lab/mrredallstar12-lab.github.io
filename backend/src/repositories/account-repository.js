import { jsonString, newId } from "../foundation/ids.js";
import { randomInt } from "node:crypto";
import { encryptSensitiveValue, digestSensitiveValue } from "../security/field-crypto.js";
import { validateUsername } from "../security/username.js";

export class AccountRepository {
  constructor(db, options = {}) {
    this.db = db;
    this.identityPepper = options.identityPepper || "";
    this.fieldEncryptionKey = options.fieldEncryptionKey || "";
    this.fieldEncryptionKeyId = options.fieldEncryptionKeyId || "env:v1";
  }

  emailDigest(email) {
    return digestSensitiveValue(email, this.identityPepper);
  }

  async usernameAvailable(normalized) {
    const active = await this.db.prepare("SELECT account_id FROM account_profiles WHERE username_normalized = ?").bind(normalized).first();
    if (active) return false;
    const reserved = await this.db.prepare("SELECT id FROM username_history WHERE username_normalized = ? AND reserved_until > ? LIMIT 1").bind(normalized, new Date().toISOString()).first();
    return !reserved;
  }

  async createAccountWithEmail({ username, email }) {
    const checked = validateUsername(username);
    if (!checked.ok) return { ok: false, error: checked };
    if (!(await this.usernameAvailable(checked.normalized))) return { ok: false, error: { code: "username_unavailable", message: "That username is unavailable." } };
    if (!this.fieldEncryptionKey) throw new Error("field_encryption_key_required");

    const accountId = newId("acct");
    const profileId = accountId;
    const archiveId = newId("archid");
    const sensitiveId = newId("sid");
    const externalId = newId("extid");
    const emailDigest = this.emailDigest(email);
    const encryptedEmail = encryptSensitiveValue(email, this.fieldEncryptionKey, this.fieldEncryptionKeyId);
    const archiveDesignation = `VISITOR-${randomInt(100000, 1000000)}`;

    await this.db.transaction(() => {
      this.db.database.prepare("INSERT INTO accounts (id, status) VALUES (?, 'active')").run(accountId);
      this.db.database.prepare(`
        INSERT INTO account_profiles (account_id, username_display, username_normalized)
        VALUES (?, ?, ?)
      `).run(profileId, checked.display, checked.normalized);
      this.db.database.prepare(`
        INSERT INTO external_identities (id, account_id, provider, provider_subject, email_digest, metadata_json)
        VALUES (?, ?, 'email', ?, ?, ?)
      `).run(externalId, accountId, emailDigest, emailDigest, jsonString({ phase: 3 }));
      this.db.database.prepare(`
        INSERT INTO sensitive_identity_data (id, account_id, data_type, data_digest, encrypted_value, encryption_key_id)
        VALUES (?, ?, 'email', ?, ?, ?)
      `).run(sensitiveId, accountId, emailDigest, encryptedEmail, this.fieldEncryptionKeyId);
      this.db.database.prepare(`
        INSERT INTO archive_identities (id, account_id, designation, clearance_state_json)
        VALUES (?, ?, ?, '{}')
      `).run(archiveId, accountId, archiveDesignation);
    });
    return { ok: true, accountId, username: checked.display, usernameNormalized: checked.normalized, archiveDesignation };
  }

  async findByUsername(username) {
    const normalized = String(username || "").trim().toLowerCase();
    return await this.db.prepare(`
      SELECT a.id, a.status, p.username_display, p.username_normalized, ai.designation AS archive_designation
      FROM account_profiles p
      JOIN accounts a ON a.id = p.account_id
      LEFT JOIN archive_identities ai ON ai.account_id = a.id
      WHERE p.username_normalized = ?
      LIMIT 1
    `).bind(normalized).first();
  }

  async findByEmailDigest(emailDigest) {
    return await this.db.prepare(`
      SELECT a.id, a.status, p.username_display, p.username_normalized, ai.designation AS archive_designation
      FROM external_identities ei
      JOIN accounts a ON a.id = ei.account_id
      JOIN account_profiles p ON p.account_id = a.id
      LEFT JOIN archive_identities ai ON ai.account_id = a.id
      WHERE ei.provider = 'email' AND ei.provider_subject = ?
      LIMIT 1
    `).bind(emailDigest).first();
  }

  async publicAccountById(accountId) {
    return await this.db.prepare(`
      SELECT p.username_display, p.username_normalized, ai.designation AS archive_designation
      FROM account_profiles p
      LEFT JOIN archive_identities ai ON ai.account_id = p.account_id
      WHERE p.account_id = ?
      LIMIT 1
    `).bind(accountId).first();
  }
}

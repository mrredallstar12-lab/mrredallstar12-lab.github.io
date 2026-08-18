import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SQLiteD1Adapter } from "../db/sqlite-adapter.js";
import { applyMigrations } from "../db/migrations.js";
import { AuditRepository } from "../repositories/audit-repository.js";
import { digestSensitiveValue } from "../security/field-crypto.js";
import { loadServerConfig } from "../server/config.js";

function argValue(name) {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : "";
}

const config = loadServerConfig();
if (!["development", "staging", "test"].includes(config.envName)) {
  console.error("Staging account cleanup refused: OFA_ENV must be development, staging, or test.");
  process.exit(2);
}
if (process.env.OFA_STAGING_CLEANUP_CONFIRM !== "DELETE_STAGING_TEST_ACCOUNT") {
  console.error("Staging account cleanup refused: set OFA_STAGING_CLEANUP_CONFIRM=DELETE_STAGING_TEST_ACCOUNT.");
  process.exit(2);
}

const username = argValue("username") || process.env.OFA_STAGING_CLEANUP_USERNAME || "";
const email = argValue("email") || process.env.OFA_STAGING_CLEANUP_EMAIL || "";
if (!username || !email) {
  console.error("Staging account cleanup refused: provide --username=<test-username> and --email=<test-email>.");
  process.exit(2);
}

const normalizedUsername = username.trim().toLowerCase();
const emailDigest = digestSensitiveValue(email, config.identityPepper);
const backendDir = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const db = new SQLiteD1Adapter(config.sqlitePath);

try {
  await applyMigrations(db, join(backendDir, "migrations-server"));
  const auditRepo = new AuditRepository(db);
  const account = await db.prepare(`
    SELECT a.id, p.username_display, p.username_normalized
    FROM accounts a
    JOIN account_profiles p ON p.account_id = a.id
    JOIN external_identities ei ON ei.account_id = a.id
    WHERE p.username_normalized = ?
      AND ei.provider = 'email'
      AND ei.provider_subject = ?
    LIMIT 1
  `).bind(normalizedUsername, emailDigest).first();

  if (!account) {
    await auditRepo.record({ actorType: "service", serviceId: "staging-account-cleanup", action: "staging.account.cleanup", result: "not_found", context: { username: normalizedUsername } });
    console.error("Staging account cleanup refused: no account matched both username and email.");
    process.exit(4);
  }

  const activeRole = await db.prepare(`
    SELECT r.role_key
    FROM account_roles ar
    JOIN roles r ON r.id = ar.role_id
    WHERE ar.account_id = ? AND ar.revoked_at IS NULL
    LIMIT 1
  `).bind(account.id).first();
  if (activeRole) {
    await auditRepo.record({ actorType: "service", serviceId: "staging-account-cleanup", action: "staging.account.cleanup", resourceType: "account", resourceId: account.id, result: "refused_active_role", context: { username: normalizedUsername, role: activeRole.role_key } });
    console.error("Staging account cleanup refused: account has an active role.");
    process.exit(3);
  }

  await db.transaction(() => {
    const raw = db.database;
    raw.prepare("DELETE FROM session_csrf_tokens WHERE session_id IN (SELECT id FROM sessions WHERE account_id = ?)").run(account.id);
    raw.prepare("DELETE FROM sessions WHERE account_id = ?").run(account.id);
    raw.prepare("DELETE FROM auth_email_challenges WHERE account_id = ? OR email_digest = ?").run(account.id, emailDigest);
    raw.prepare("DELETE FROM auth_rate_limits WHERE bucket_key IN (?, ?)").run(`register:${emailDigest}`, `email-start:${emailDigest}`);
    raw.prepare("DELETE FROM inventory_relationships WHERE account_id = ?").run(account.id);
    raw.prepare("DELETE FROM inventory_item_history WHERE item_instance_id IN (SELECT id FROM inventory_item_instances WHERE owner_account_id = ?)").run(account.id);
    raw.prepare("DELETE FROM inventory_ledger WHERE account_id = ?").run(account.id);
    raw.prepare("DELETE FROM inventory_balances WHERE account_id = ?").run(account.id);
    raw.prepare("DELETE FROM inventory_item_instances WHERE owner_account_id = ?").run(account.id);
    raw.prepare("DELETE FROM account_discoveries WHERE account_id = ?").run(account.id);
    raw.prepare("DELETE FROM account_relationships WHERE account_id = ?").run(account.id);
    raw.prepare("DELETE FROM account_annotations WHERE account_id = ?").run(account.id);
    raw.prepare("DELETE FROM account_private_state WHERE account_id = ?").run(account.id);
    raw.prepare("DELETE FROM account_roles WHERE account_id = ?").run(account.id);
    raw.prepare("DELETE FROM username_history WHERE account_id = ?").run(account.id);
    raw.prepare("DELETE FROM sensitive_identity_data WHERE account_id = ?").run(account.id);
    raw.prepare("DELETE FROM external_identities WHERE account_id = ?").run(account.id);
    raw.prepare("DELETE FROM archive_identities WHERE account_id = ?").run(account.id);
    raw.prepare("DELETE FROM account_identities WHERE account_id = ?").run(account.id);
    raw.prepare("DELETE FROM account_profiles WHERE account_id = ?").run(account.id);
    raw.prepare("DELETE FROM accounts WHERE id = ?").run(account.id);
  });

  await auditRepo.record({ actorType: "service", serviceId: "staging-account-cleanup", action: "staging.account.cleanup", resourceType: "account", resourceId: account.id, result: "deleted", context: { username: normalizedUsername } });
  console.log(JSON.stringify({ ok: true, username: account.username_display, deleted: true }, null, 2));
} finally {
  db.close();
}

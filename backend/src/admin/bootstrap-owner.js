import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SQLiteD1Adapter } from "../db/sqlite-adapter.js";
import { applyMigrations } from "../db/migrations.js";
import { AccountRepository } from "../repositories/account-repository.js";
import { AuditRepository } from "../repositories/audit-repository.js";
import { AuthRepository } from "../repositories/auth-repository.js";
import { loadServerConfig } from "../server/config.js";

function argValue(name) {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : "";
}

const config = loadServerConfig();
if (process.env.OFA_OWNER_BOOTSTRAP_ENABLED !== "true" || process.env.OFA_OWNER_BOOTSTRAP_CONFIRM !== "BOOTSTRAP_OWNER") {
  console.error("Owner bootstrap refused: set OFA_OWNER_BOOTSTRAP_ENABLED=true and OFA_OWNER_BOOTSTRAP_CONFIRM=BOOTSTRAP_OWNER for this explicit operation.");
  process.exit(2);
}

const username = argValue("username") || process.env.OFA_OWNER_BOOTSTRAP_USERNAME || "";
if (!username) {
  console.error("Owner bootstrap refused: provide --username=<existing-username>.");
  process.exit(2);
}

const backendDir = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const db = new SQLiteD1Adapter(config.sqlitePath);
try {
  await applyMigrations(db, join(backendDir, "migrations-server"));
  const accountRepo = new AccountRepository(db, {
    identityPepper: config.identityPepper,
    fieldEncryptionKey: config.fieldEncryptionKey,
    fieldEncryptionKeyId: config.fieldEncryptionKeyId
  });
  const authRepo = new AuthRepository(db, { sessionPepper: config.sessionPepper });
  const auditRepo = new AuditRepository(db);
  const existingOwner = await db.prepare(`
    SELECT ar.account_id
    FROM account_roles ar
    JOIN roles r ON r.id = ar.role_id
    WHERE r.role_key = 'owner' AND ar.revoked_at IS NULL
    LIMIT 1
  `).first();
  if (existingOwner) {
    await auditRepo.record({ actorType: "service", serviceId: "owner-bootstrap", action: "owner.bootstrap", result: "refused_existing_owner", resourceType: "account", resourceId: existingOwner.account_id });
    console.error("Owner bootstrap refused: an active owner is already bootstrapped.");
    process.exit(3);
  }
  const account = await accountRepo.findByUsername(username);
  if (!account) {
    await auditRepo.record({ actorType: "service", serviceId: "owner-bootstrap", action: "owner.bootstrap", result: "refused_account_not_found" });
    console.error("Owner bootstrap refused: selected account was not found.");
    process.exit(4);
  }
  await authRepo.grantRole(account.id, "owner", "global", "owner-bootstrap");
  await db.prepare("INSERT OR IGNORE INTO bootstrap_locks (lock_key, account_id) VALUES ('owner', ?)").bind(account.id).run();
  await auditRepo.record({ actorType: "service", serviceId: "owner-bootstrap", action: "owner.bootstrap", result: "granted", resourceType: "account", resourceId: account.id, context: { username: account.username_normalized, env: config.envName } });
  console.log(JSON.stringify({ ok: true, username: account.username_display, role: "owner" }, null, 2));
} finally {
  db.close();
}


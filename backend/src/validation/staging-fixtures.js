import { randomUUID } from "node:crypto";
import { AccountRepository } from "../repositories/account-repository.js";
import { AuthRepository } from "../repositories/auth-repository.js";

export async function createValidationFixtures(db, config) {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 10);
  const accounts = new AccountRepository(db, {
    identityPepper: config.identityPepper,
    fieldEncryptionKey: config.fieldEncryptionKey,
    fieldEncryptionKeyId: config.fieldEncryptionKeyId
  });
  const auth = new AuthRepository(db, { sessionPepper: config.sessionPepper });

  const adminUsername = `ValAdmin${suffix}`;
  const playerUsername = `ValPlayer${suffix}`;
  const admin = await accounts.createAccountWithEmail({ username: adminUsername, email: `${suffix}-admin@example.invalid` });
  const player = await accounts.createAccountWithEmail({ username: playerUsername, email: `${suffix}-player@example.invalid` });
  if (!admin.ok || !player.ok) throw new Error("validation_fixture_creation_failed");

  await auth.grantRole(admin.accountId, "system_admin", "global", "staging-validation-harness");
  const adminSession = await auth.createSession({ accountId: admin.accountId, metadata: { source: "staging-validation-harness" } });
  const playerSession = await auth.createSession({ accountId: player.accountId, metadata: { source: "staging-validation-harness" } });

  return {
    suffix,
    admin: { ...admin, session: adminSession },
    player: { ...player, session: playerSession },
    itemKey: `staging_validation_item_${suffix}`
  };
}

export async function cleanupValidationFixtures(db, fixture, requestPrefix) {
  if (!fixture) return;
  const accountIds = [fixture.admin.accountId, fixture.player.accountId];
  const raw = db.database;

  db.transaction(() => {
    raw.prepare("DELETE FROM audit_events WHERE request_id LIKE ? OR actor_id IN (?, ?) OR resource_id IN (?, ?)")
      .run(`${requestPrefix}%`, ...accountIds, ...accountIds);
    raw.prepare("DELETE FROM admin_elevations WHERE account_id IN (?, ?)").run(...accountIds);
    raw.prepare("DELETE FROM session_csrf_tokens WHERE session_id IN (SELECT id FROM sessions WHERE account_id IN (?, ?))").run(...accountIds);
    raw.prepare("DELETE FROM sessions WHERE account_id IN (?, ?)").run(...accountIds);
    raw.prepare("DELETE FROM auth_email_challenges WHERE account_id IN (?, ?)").run(...accountIds);
    for (const accountId of accountIds) {
      raw.prepare("DELETE FROM auth_rate_limits WHERE bucket_key LIKE ?").run(`%${accountId}%`);
    }
    raw.prepare("DELETE FROM inventory_relationships WHERE account_id IN (?, ?)").run(...accountIds);
    raw.prepare("DELETE FROM inventory_item_history WHERE item_instance_id IN (SELECT id FROM inventory_item_instances WHERE owner_account_id IN (?, ?))").run(...accountIds);
    raw.prepare("DELETE FROM inventory_ledger WHERE account_id IN (?, ?)").run(...accountIds);
    raw.prepare("DELETE FROM inventory_balances WHERE account_id IN (?, ?)").run(...accountIds);
    raw.prepare("DELETE FROM inventory_item_instances WHERE owner_account_id IN (?, ?)").run(...accountIds);
    raw.prepare("DELETE FROM inventory_item_definitions WHERE item_key = ?").run(fixture.itemKey);
    raw.prepare("DELETE FROM account_discoveries WHERE account_id IN (?, ?)").run(...accountIds);
    raw.prepare("DELETE FROM account_relationships WHERE account_id IN (?, ?)").run(...accountIds);
    raw.prepare("DELETE FROM account_annotations WHERE account_id IN (?, ?)").run(...accountIds);
    raw.prepare("DELETE FROM account_private_state WHERE account_id IN (?, ?)").run(...accountIds);
    raw.prepare("DELETE FROM account_roles WHERE account_id IN (?, ?)").run(...accountIds);
    raw.prepare("DELETE FROM username_history WHERE account_id IN (?, ?)").run(...accountIds);
    raw.prepare("DELETE FROM sensitive_identity_data WHERE account_id IN (?, ?)").run(...accountIds);
    raw.prepare("DELETE FROM external_identities WHERE account_id IN (?, ?)").run(...accountIds);
    raw.prepare("DELETE FROM archive_identities WHERE account_id IN (?, ?)").run(...accountIds);
    raw.prepare("DELETE FROM account_identities WHERE account_id IN (?, ?)").run(...accountIds);
    raw.prepare("DELETE FROM account_profiles WHERE account_id IN (?, ?)").run(...accountIds);
    raw.prepare("DELETE FROM accounts WHERE id IN (?, ?)").run(...accountIds);
  });
}

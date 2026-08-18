CREATE TABLE IF NOT EXISTS account_profiles (
  account_id TEXT PRIMARY KEY,
  username_display TEXT NOT NULL,
  username_normalized TEXT NOT NULL UNIQUE,
  username_changed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(account_id) REFERENCES accounts(id)
);

CREATE TABLE IF NOT EXISTS username_history (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  username_display TEXT NOT NULL,
  username_normalized TEXT NOT NULL,
  reserved_until TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(account_id) REFERENCES accounts(id)
);

CREATE INDEX IF NOT EXISTS idx_username_history_normalized ON username_history(username_normalized, reserved_until);

CREATE TABLE IF NOT EXISTS sensitive_identity_data (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  data_type TEXT NOT NULL,
  data_digest TEXT NOT NULL,
  encrypted_value TEXT NOT NULL,
  encryption_key_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(data_type, data_digest),
  FOREIGN KEY(account_id) REFERENCES accounts(id)
);

CREATE TABLE IF NOT EXISTS auth_email_challenges (
  id TEXT PRIMARY KEY,
  purpose TEXT NOT NULL,
  email_digest TEXT NOT NULL,
  account_id TEXT,
  token_digest TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active',
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  revoked_at TEXT,
  request_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(account_id) REFERENCES accounts(id)
);

CREATE INDEX IF NOT EXISTS idx_auth_email_challenges_digest ON auth_email_challenges(token_digest);
CREATE INDEX IF NOT EXISTS idx_auth_email_challenges_email ON auth_email_challenges(email_digest, purpose, status);

CREATE TABLE IF NOT EXISTS session_csrf_tokens (
  session_id TEXT PRIMARY KEY,
  token_digest TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(session_id) REFERENCES sessions(id)
);

CREATE TABLE IF NOT EXISTS auth_rate_limits (
  bucket_key TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0,
  reset_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS account_private_state (
  account_id TEXT NOT NULL,
  state_key TEXT NOT NULL,
  value_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(account_id, state_key),
  FOREIGN KEY(account_id) REFERENCES accounts(id)
);

CREATE TABLE IF NOT EXISTS bootstrap_locks (
  lock_key TEXT PRIMARY KEY,
  account_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(account_id) REFERENCES accounts(id)
);

INSERT OR IGNORE INTO permissions (id, permission_key, description) VALUES
  ('perm_owner_manage', 'owner.manage', 'Break-glass owner administration'),
  ('perm_security_manage', 'security.manage', 'Manage security-sensitive settings'),
  ('perm_accounts_read', 'accounts.read', 'Read account administration data'),
  ('perm_content_write', 'records.write', 'Create and edit archive records'),
  ('perm_inventory_grant', 'inventory.grant', 'Grant or revoke server-authoritative inventory'),
  ('perm_logs_read', 'logs.read', 'Read operational and security logs');

INSERT OR IGNORE INTO roles (id, role_key, label, description) VALUES
  ('role_owner', 'owner', 'Owner', 'Extremely restricted owner role'),
  ('role_system_admin', 'system_admin', 'System Admin', 'Deployment, config, and security operations'),
  ('role_content_admin', 'content_admin', 'Content Admin', 'Content and world-state operations'),
  ('role_moderator', 'moderator', 'Moderator', 'Submission and report moderation'),
  ('role_developer_readonly', 'developer_readonly', 'Read-only Developer', 'Scoped diagnostics and read-only inspection'),
  ('role_account', 'account', 'Account', 'Normal authenticated account');

INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT 'role_owner', id FROM permissions WHERE permission_key IN ('owner.manage','security.manage','accounts.read','records.write','inventory.grant','logs.read');

INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT 'role_system_admin', id FROM permissions WHERE permission_key IN ('security.manage','accounts.read','logs.read');

INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT 'role_content_admin', id FROM permissions WHERE permission_key IN ('records.write','inventory.grant');

INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT 'role_developer_readonly', id FROM permissions WHERE permission_key IN ('logs.read');

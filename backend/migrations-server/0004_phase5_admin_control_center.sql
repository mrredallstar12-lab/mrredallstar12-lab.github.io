CREATE TABLE IF NOT EXISTS admin_elevations (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  issued_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  reason TEXT,
  request_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(session_id) REFERENCES sessions(id),
  FOREIGN KEY(account_id) REFERENCES accounts(id)
);

CREATE INDEX IF NOT EXISTS idx_admin_elevations_session ON admin_elevations(session_id, status, expires_at);
CREATE INDEX IF NOT EXISTS idx_admin_elevations_account ON admin_elevations(account_id, status, expires_at);

CREATE TABLE IF NOT EXISTS operational_modes (
  mode_key TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 0,
  reason TEXT,
  updated_by TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(updated_by) REFERENCES accounts(id)
);

INSERT OR IGNORE INTO operational_modes (mode_key, enabled, reason) VALUES
  ('registrations_disabled', 0, 'default'),
  ('auth_initiation_disabled', 0, 'default'),
  ('player_mutations_disabled', 0, 'default'),
  ('authored_events_disabled', 0, 'schema_only_until_event_engine');

INSERT OR IGNORE INTO permissions (id, permission_key, description) VALUES
  ('perm_admin_access', 'admin.access', 'Access the privileged Control Center'),
  ('perm_players_inspect', 'players.inspect', 'Inspect player operational state'),
  ('perm_players_mutate', 'players.mutate', 'Perform typed player state operations'),
  ('perm_operations_manage', 'operations.manage', 'Manage operational safety modes'),
  ('perm_sessions_revoke', 'sessions.revoke', 'Revoke account and global sessions');

INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT 'role_owner', id FROM permissions WHERE permission_key IN ('admin.access','players.inspect','players.mutate','operations.manage','sessions.revoke');

INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT 'role_system_admin', id FROM permissions WHERE permission_key IN ('admin.access','players.inspect','players.mutate','operations.manage','sessions.revoke');

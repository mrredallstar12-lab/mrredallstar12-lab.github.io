CREATE TABLE IF NOT EXISTS authored_event_versions (
  id TEXT PRIMARY KEY,
  authored_event_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  trigger_event_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  priority INTEGER NOT NULL DEFAULT 0,
  condition_json TEXT NOT NULL,
  schema_version INTEGER NOT NULL DEFAULT 1,
  definition_checksum TEXT NOT NULL,
  player_safe_label TEXT,
  player_safe_summary TEXT,
  fixture_namespace TEXT,
  created_by TEXT,
  published_by TEXT,
  published_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(authored_event_id, version),
  FOREIGN KEY(authored_event_id) REFERENCES authored_events(id),
  FOREIGN KEY(created_by) REFERENCES accounts(id),
  FOREIGN KEY(published_by) REFERENCES accounts(id)
);

CREATE INDEX IF NOT EXISTS idx_authored_event_versions_trigger ON authored_event_versions(trigger_event_type, status, priority);

CREATE TABLE IF NOT EXISTS authored_event_version_effects (
  id TEXT PRIMARY KEY,
  definition_version_id TEXT NOT NULL,
  effect_key TEXT NOT NULL,
  effect_order INTEGER NOT NULL,
  effect_type TEXT NOT NULL,
  effect_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(definition_version_id, effect_key),
  UNIQUE(definition_version_id, effect_order),
  FOREIGN KEY(definition_version_id) REFERENCES authored_event_versions(id)
);

CREATE TRIGGER IF NOT EXISTS prevent_published_event_version_update
BEFORE UPDATE ON authored_event_versions
WHEN OLD.status = 'published' AND OLD.fixture_namespace IS NULL
BEGIN
  SELECT RAISE(ABORT, 'published_event_version_immutable');
END;

CREATE TRIGGER IF NOT EXISTS prevent_published_event_version_delete
BEFORE DELETE ON authored_event_versions
WHEN OLD.status = 'published' AND OLD.fixture_namespace IS NULL
BEGIN
  SELECT RAISE(ABORT, 'published_event_version_immutable');
END;

CREATE TRIGGER IF NOT EXISTS prevent_published_event_effect_update
BEFORE UPDATE ON authored_event_version_effects
WHEN EXISTS (
  SELECT 1 FROM authored_event_versions v
  WHERE v.id = OLD.definition_version_id AND v.status = 'published' AND v.fixture_namespace IS NULL
)
BEGIN
  SELECT RAISE(ABORT, 'published_event_version_immutable');
END;

CREATE TRIGGER IF NOT EXISTS prevent_published_event_effect_delete
BEFORE DELETE ON authored_event_version_effects
WHEN EXISTS (
  SELECT 1 FROM authored_event_versions v
  WHERE v.id = OLD.definition_version_id AND v.status = 'published' AND v.fixture_namespace IS NULL
)
BEGIN
  SELECT RAISE(ABORT, 'published_event_version_immutable');
END;

CREATE TABLE IF NOT EXISTS progression_events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  schema_version INTEGER NOT NULL DEFAULT 1,
  account_id TEXT,
  source_type TEXT NOT NULL,
  source_subject TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  payload_digest TEXT NOT NULL,
  provenance_json TEXT NOT NULL DEFAULT '{}',
  request_id TEXT,
  status TEXT NOT NULL DEFAULT 'processing',
  received_at TEXT NOT NULL,
  occurred_at TEXT,
  root_event_id TEXT,
  parent_event_id TEXT,
  chain_depth INTEGER NOT NULL DEFAULT 0,
  completion_code TEXT,
  failure_code TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(source_type, source_subject, idempotency_key),
  FOREIGN KEY(account_id) REFERENCES accounts(id),
  FOREIGN KEY(root_event_id) REFERENCES progression_events(id),
  FOREIGN KEY(parent_event_id) REFERENCES progression_events(id)
);

CREATE INDEX IF NOT EXISTS idx_progression_events_account_time ON progression_events(account_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_progression_events_type_time ON progression_events(event_type, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_progression_events_root ON progression_events(root_event_id, chain_depth);
CREATE INDEX IF NOT EXISTS idx_progression_events_status ON progression_events(status, received_at);

CREATE TABLE IF NOT EXISTS progression_rule_evaluations (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  definition_version_id TEXT NOT NULL,
  matched INTEGER NOT NULL,
  status TEXT NOT NULL,
  explanation_json TEXT NOT NULL DEFAULT '{}',
  state_snapshot_digest TEXT NOT NULL,
  evaluated_at TEXT NOT NULL,
  UNIQUE(event_id, definition_version_id),
  FOREIGN KEY(event_id) REFERENCES progression_events(id),
  FOREIGN KEY(definition_version_id) REFERENCES authored_event_versions(id)
);

CREATE INDEX IF NOT EXISTS idx_progression_evaluations_event ON progression_rule_evaluations(event_id);

CREATE TABLE IF NOT EXISTS progression_effect_applications (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  evaluation_id TEXT NOT NULL,
  effect_definition_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  effect_type TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_key TEXT,
  status TEXT NOT NULL,
  before_json TEXT NOT NULL DEFAULT '{}',
  after_json TEXT NOT NULL DEFAULT '{}',
  provenance_json TEXT NOT NULL DEFAULT '{}',
  applied_at TEXT NOT NULL,
  FOREIGN KEY(event_id) REFERENCES progression_events(id),
  FOREIGN KEY(evaluation_id) REFERENCES progression_rule_evaluations(id),
  FOREIGN KEY(effect_definition_id) REFERENCES authored_event_version_effects(id)
);

CREATE INDEX IF NOT EXISTS idx_progression_effects_event ON progression_effect_applications(event_id);

CREATE TABLE IF NOT EXISTS progression_history (
  id TEXT PRIMARY KEY,
  account_id TEXT,
  scope_type TEXT NOT NULL,
  scope_key TEXT NOT NULL,
  event_id TEXT NOT NULL,
  definition_version_id TEXT NOT NULL,
  effect_application_id TEXT NOT NULL,
  change_type TEXT NOT NULL,
  subject_type TEXT NOT NULL,
  subject_key TEXT,
  reason_json TEXT NOT NULL DEFAULT '{}',
  provenance_json TEXT NOT NULL DEFAULT '{}',
  player_visibility TEXT NOT NULL DEFAULT 'internal',
  created_at TEXT NOT NULL,
  FOREIGN KEY(account_id) REFERENCES accounts(id),
  FOREIGN KEY(event_id) REFERENCES progression_events(id),
  FOREIGN KEY(definition_version_id) REFERENCES authored_event_versions(id),
  FOREIGN KEY(effect_application_id) REFERENCES progression_effect_applications(id)
);

CREATE INDEX IF NOT EXISTS idx_progression_history_account ON progression_history(account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_progression_history_event ON progression_history(event_id);

CREATE TABLE IF NOT EXISTS account_relationship_discoveries (
  account_id TEXT NOT NULL,
  relationship_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  provenance_json TEXT NOT NULL DEFAULT '{}',
  discovered_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at TEXT,
  PRIMARY KEY(account_id, relationship_id),
  FOREIGN KEY(account_id) REFERENCES accounts(id),
  FOREIGN KEY(relationship_id) REFERENCES entity_relationships(id)
);

CREATE INDEX IF NOT EXISTS idx_account_relationship_discoveries_status ON account_relationship_discoveries(account_id, status);

CREATE TABLE IF NOT EXISTS progression_outbox (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  message_type TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  available_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(event_id) REFERENCES progression_events(id)
);

INSERT OR IGNORE INTO permissions (id, permission_key, description) VALUES
  ('perm_progression_definitions_read', 'progression.definitions.read', 'Inspect authored progression definitions'),
  ('perm_progression_players_read', 'progression.players.read', 'Inspect account progression execution history'),
  ('perm_progression_simulate', 'progression.simulate', 'Run privileged non-mutating progression simulations'),
  ('perm_progression_staging_trigger', 'progression.staging.trigger', 'Trigger allowlisted staging progression events');

INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT 'role_owner', id FROM permissions WHERE permission_key IN (
  'progression.definitions.read', 'progression.players.read', 'progression.simulate', 'progression.staging.trigger'
);

INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT 'role_system_admin', id FROM permissions WHERE permission_key IN (
  'progression.definitions.read', 'progression.players.read', 'progression.simulate', 'progression.staging.trigger'
);

INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT 'role_developer_readonly', id FROM permissions WHERE permission_key = 'progression.definitions.read';

UPDATE operational_modes
SET enabled = 1,
    reason = 'phase6_default_disabled_until_physical_validation',
    updated_by = NULL,
    updated_at = CURRENT_TIMESTAMP
WHERE mode_key = 'authored_events_disabled';

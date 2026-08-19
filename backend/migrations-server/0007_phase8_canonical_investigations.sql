CREATE TABLE IF NOT EXISTS canonical_interactions (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  interaction_type TEXT NOT NULL,
  schema_version INTEGER NOT NULL DEFAULT 1,
  source_type TEXT NOT NULL,
  source_subject TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  resource_revision TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  input_digest TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'processing',
  result_code TEXT,
  progression_event_id TEXT,
  request_id TEXT,
  provenance_json TEXT NOT NULL DEFAULT '{}',
  received_at TEXT NOT NULL,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(source_type, source_subject, idempotency_key),
  FOREIGN KEY(account_id) REFERENCES accounts(id),
  FOREIGN KEY(progression_event_id) REFERENCES progression_events(id)
);

CREATE INDEX IF NOT EXISTS idx_canonical_interactions_account
  ON canonical_interactions(account_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_canonical_interactions_resource
  ON canonical_interactions(resource_type, resource_id, resource_revision);

CREATE TABLE IF NOT EXISTS case_investigation_definitions (
  id TEXT PRIMARY KEY,
  investigation_key TEXT NOT NULL UNIQUE,
  case_record_id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(case_record_id) REFERENCES records(id)
);

CREATE TABLE IF NOT EXISTS case_investigation_versions (
  id TEXT PRIMARY KEY,
  definition_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  player_title TEXT NOT NULL,
  player_summary TEXT,
  eligibility_condition_json TEXT,
  fixture_namespace TEXT,
  created_by TEXT,
  published_at TEXT,
  withdrawn_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(definition_id, version),
  FOREIGN KEY(definition_id) REFERENCES case_investigation_definitions(id),
  FOREIGN KEY(created_by) REFERENCES accounts(id)
);

CREATE INDEX IF NOT EXISTS idx_case_investigation_versions_published
  ON case_investigation_versions(definition_id, status, version DESC);

CREATE TABLE IF NOT EXISTS case_investigation_steps (
  id TEXT PRIMARY KEY,
  investigation_version_id TEXT NOT NULL,
  step_key TEXT NOT NULL,
  step_order INTEGER NOT NULL,
  step_kind TEXT NOT NULL,
  player_label TEXT NOT NULL,
  player_prompt TEXT,
  public_metadata_json TEXT NOT NULL DEFAULT '{}',
  visibility_condition_json TEXT,
  eligibility_condition_json TEXT,
  verifier_ciphertext TEXT NOT NULL,
  verifier_key_id TEXT NOT NULL,
  normalization_version INTEGER NOT NULL DEFAULT 1,
  attempt_policy_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(investigation_version_id, step_key),
  UNIQUE(investigation_version_id, step_order),
  FOREIGN KEY(investigation_version_id) REFERENCES case_investigation_versions(id)
);

CREATE INDEX IF NOT EXISTS idx_case_investigation_steps_order
  ON case_investigation_steps(investigation_version_id, step_order);

CREATE TABLE IF NOT EXISTS account_case_investigations (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  investigation_version_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  started_at TEXT NOT NULL,
  resolved_at TEXT,
  closed_at TEXT,
  last_activity_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(account_id, investigation_version_id),
  FOREIGN KEY(account_id) REFERENCES accounts(id),
  FOREIGN KEY(investigation_version_id) REFERENCES case_investigation_versions(id)
);

CREATE INDEX IF NOT EXISTS idx_account_case_investigations_account
  ON account_case_investigations(account_id, last_activity_at DESC);

CREATE TABLE IF NOT EXISTS case_investigation_attempts (
  id TEXT PRIMARY KEY,
  account_investigation_id TEXT NOT NULL,
  step_version_id TEXT NOT NULL,
  interaction_id TEXT NOT NULL,
  submission_fingerprint TEXT NOT NULL,
  outcome TEXT NOT NULL,
  attempt_ordinal INTEGER NOT NULL,
  request_id TEXT,
  provenance_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  UNIQUE(account_investigation_id, step_version_id, submission_fingerprint),
  UNIQUE(account_investigation_id, step_version_id, attempt_ordinal),
  FOREIGN KEY(account_investigation_id) REFERENCES account_case_investigations(id),
  FOREIGN KEY(step_version_id) REFERENCES case_investigation_steps(id),
  FOREIGN KEY(interaction_id) REFERENCES canonical_interactions(id)
);

CREATE INDEX IF NOT EXISTS idx_case_investigation_attempts_rate
  ON case_investigation_attempts(account_investigation_id, step_version_id, created_at DESC);

CREATE TABLE IF NOT EXISTS case_investigation_resolutions (
  account_investigation_id TEXT NOT NULL,
  step_version_id TEXT NOT NULL,
  accepted_attempt_id TEXT NOT NULL,
  progression_event_id TEXT NOT NULL,
  resolved_at TEXT NOT NULL,
  PRIMARY KEY(account_investigation_id, step_version_id),
  FOREIGN KEY(account_investigation_id) REFERENCES account_case_investigations(id),
  FOREIGN KEY(step_version_id) REFERENCES case_investigation_steps(id),
  FOREIGN KEY(accepted_attempt_id) REFERENCES case_investigation_attempts(id),
  FOREIGN KEY(progression_event_id) REFERENCES progression_events(id)
);

CREATE TABLE IF NOT EXISTS case_evidence_pins (
  id TEXT PRIMARY KEY,
  account_investigation_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  public_ref TEXT NOT NULL,
  interaction_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  pinned_at TEXT NOT NULL,
  unpinned_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(account_investigation_id, target_type, target_id),
  UNIQUE(account_id, public_ref),
  FOREIGN KEY(account_investigation_id) REFERENCES account_case_investigations(id),
  FOREIGN KEY(account_id) REFERENCES accounts(id),
  FOREIGN KEY(interaction_id) REFERENCES canonical_interactions(id)
);

CREATE INDEX IF NOT EXISTS idx_case_evidence_pins_active
  ON case_evidence_pins(account_investigation_id, status, pinned_at);

CREATE TRIGGER IF NOT EXISTS prevent_published_investigation_version_update
BEFORE UPDATE ON case_investigation_versions
WHEN OLD.status = 'published' AND OLD.fixture_namespace IS NULL
BEGIN
  SELECT RAISE(ABORT, 'published_investigation_version_immutable');
END;

CREATE TRIGGER IF NOT EXISTS prevent_published_investigation_version_delete
BEFORE DELETE ON case_investigation_versions
WHEN OLD.status = 'published' AND OLD.fixture_namespace IS NULL
BEGIN
  SELECT RAISE(ABORT, 'published_investigation_version_immutable');
END;

CREATE TRIGGER IF NOT EXISTS prevent_published_investigation_step_update
BEFORE UPDATE ON case_investigation_steps
WHEN EXISTS (
  SELECT 1 FROM case_investigation_versions v
  WHERE v.id = OLD.investigation_version_id AND v.status = 'published' AND v.fixture_namespace IS NULL
)
BEGIN
  SELECT RAISE(ABORT, 'published_investigation_version_immutable');
END;

CREATE TRIGGER IF NOT EXISTS prevent_published_investigation_step_delete
BEFORE DELETE ON case_investigation_steps
WHEN EXISTS (
  SELECT 1 FROM case_investigation_versions v
  WHERE v.id = OLD.investigation_version_id AND v.status = 'published' AND v.fixture_namespace IS NULL
)
BEGIN
  SELECT RAISE(ABORT, 'published_investigation_version_immutable');
END;

INSERT OR IGNORE INTO operational_modes (mode_key, enabled, reason)
VALUES ('investigations_disabled', 1, 'phase8_default_disabled_until_physical_validation');

INSERT OR IGNORE INTO permissions (id, permission_key, description) VALUES
  ('perm_investigations_read', 'investigations.read', 'Inspect investigation definitions and account investigation history');

INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT 'role_owner', id FROM permissions WHERE permission_key = 'investigations.read';

INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT 'role_system_admin', id FROM permissions WHERE permission_key = 'investigations.read';

INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT 'role_developer_readonly', id FROM permissions WHERE permission_key = 'investigations.read';

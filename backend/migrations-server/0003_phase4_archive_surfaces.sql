CREATE TABLE IF NOT EXISTS archive_visibility_policies (
  id TEXT PRIMARY KEY,
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  existence_behavior TEXT NOT NULL DEFAULT 'not_found',
  catalog_rule_json TEXT NOT NULL DEFAULT '{"access":"public"}',
  field_rules_json TEXT NOT NULL DEFAULT '{}',
  relationship_rule_json TEXT NOT NULL DEFAULT '{"access":"public"}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(resource_type, resource_id)
);

CREATE INDEX IF NOT EXISTS idx_archive_visibility_resource ON archive_visibility_policies(resource_type, resource_id);

CREATE TABLE IF NOT EXISTS record_protected_fields (
  record_id TEXT NOT NULL,
  field_key TEXT NOT NULL,
  value_json TEXT NOT NULL DEFAULT 'null',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(record_id, field_key),
  FOREIGN KEY(record_id) REFERENCES records(id)
);

CREATE TABLE IF NOT EXISTS phase4_staging_seed_markers (
  seed_key TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS account_identities (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  identity_type TEXT NOT NULL,
  public_handle TEXT,
  display_label TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(account_id) REFERENCES accounts(id)
);

CREATE TABLE IF NOT EXISTS external_identities (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_subject TEXT NOT NULL,
  email_digest TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(provider, provider_subject),
  FOREIGN KEY(account_id) REFERENCES accounts(id)
);

CREATE TABLE IF NOT EXISTS archive_identities (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  designation TEXT NOT NULL,
  clearance_state_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(account_id),
  FOREIGN KEY(account_id) REFERENCES accounts(id)
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  account_id TEXT,
  token_digest TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active',
  issued_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  revocation_reason TEXT,
  last_seen_at TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  FOREIGN KEY(account_id) REFERENCES accounts(id)
);

CREATE INDEX IF NOT EXISTS idx_sessions_digest ON sessions(token_digest);
CREATE INDEX IF NOT EXISTS idx_sessions_account ON sessions(account_id, status);

CREATE TABLE IF NOT EXISTS roles (
  id TEXT PRIMARY KEY,
  role_key TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  description TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS permissions (
  id TEXT PRIMARY KEY,
  permission_key TEXT NOT NULL UNIQUE,
  description TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id TEXT NOT NULL,
  permission_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(role_id, permission_id),
  FOREIGN KEY(role_id) REFERENCES roles(id),
  FOREIGN KEY(permission_id) REFERENCES permissions(id)
);

CREATE TABLE IF NOT EXISTS account_roles (
  account_id TEXT NOT NULL,
  role_id TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'global',
  granted_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at TEXT,
  PRIMARY KEY(account_id, role_id, scope),
  FOREIGN KEY(account_id) REFERENCES accounts(id),
  FOREIGN KEY(role_id) REFERENCES roles(id)
);

CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  actor_type TEXT NOT NULL,
  actor_id TEXT,
  service_id TEXT,
  action TEXT NOT NULL,
  resource_type TEXT,
  resource_id TEXT,
  result TEXT NOT NULL,
  request_id TEXT,
  context_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_events(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_events(actor_type, actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_resource ON audit_events(resource_type, resource_id);

CREATE TABLE IF NOT EXISTS records (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  record_type TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  visibility TEXT NOT NULL DEFAULT 'public',
  current_revision_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS record_revisions (
  id TEXT PRIMARY KEY,
  record_id TEXT NOT NULL,
  revision_number INTEGER NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  redaction_state TEXT NOT NULL DEFAULT 'none',
  authored_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(record_id, revision_number),
  FOREIGN KEY(record_id) REFERENCES records(id)
);

CREATE TABLE IF NOT EXISTS record_access_rules (
  id TEXT PRIMARY KEY,
  record_id TEXT NOT NULL,
  access_key TEXT NOT NULL,
  rule_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(record_id) REFERENCES records(id)
);

CREATE TABLE IF NOT EXISTS cases (
  id TEXT PRIMARY KEY,
  record_id TEXT,
  case_number TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'open',
  risk_level TEXT,
  containment_status TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(record_id) REFERENCES records(id)
);

CREATE TABLE IF NOT EXISTS incidents (
  id TEXT PRIMARY KEY,
  record_id TEXT,
  incident_code TEXT NOT NULL UNIQUE,
  severity TEXT,
  started_at TEXT,
  ended_at TEXT,
  facility_id TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(record_id) REFERENCES records(id)
);

CREATE TABLE IF NOT EXISTS transmissions (
  id TEXT PRIMARY KEY,
  record_id TEXT,
  channel TEXT,
  frequency TEXT,
  source_label TEXT,
  transcript TEXT,
  state TEXT NOT NULL DEFAULT 'catalogued',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(record_id) REFERENCES records(id)
);

CREATE TABLE IF NOT EXISTS transmission_receptions (
  id TEXT PRIMARY KEY,
  transmission_id TEXT NOT NULL,
  account_id TEXT,
  received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reception_context_json TEXT NOT NULL DEFAULT '{}',
  FOREIGN KEY(transmission_id) REFERENCES transmissions(id),
  FOREIGN KEY(account_id) REFERENCES accounts(id)
);

CREATE TABLE IF NOT EXISTS facilities (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  facility_type TEXT,
  parent_id TEXT,
  state_key TEXT,
  description TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(parent_id) REFERENCES facilities(id)
);

CREATE TABLE IF NOT EXISTS people (
  id TEXT PRIMARY KEY,
  person_type TEXT NOT NULL,
  label TEXT NOT NULL,
  public_name TEXT,
  status TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS media_assets (
  id TEXT PRIMARY KEY,
  storage_provider TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  mime_type TEXT,
  size_bytes INTEGER,
  moderation_status TEXT NOT NULL DEFAULT 'pending',
  protected INTEGER NOT NULL DEFAULT 0,
  provenance_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(storage_provider, storage_key)
);

CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY,
  record_id TEXT,
  artifact_code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  classification TEXT,
  backend_custody_state TEXT NOT NULL DEFAULT 'retained',
  fictional_custody_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(record_id) REFERENCES records(id)
);

CREATE TABLE IF NOT EXISTS entity_relationships (
  id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  relationship_type TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  canonical INTEGER NOT NULL DEFAULT 1,
  confidence TEXT,
  provenance_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_entity_relationships_source ON entity_relationships(source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_entity_relationships_target ON entity_relationships(target_type, target_id);

CREATE TABLE IF NOT EXISTS account_discoveries (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  discovery_type TEXT NOT NULL,
  discovery_key TEXT NOT NULL,
  resource_type TEXT,
  resource_id TEXT,
  discovered_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  provenance_json TEXT NOT NULL DEFAULT '{}',
  UNIQUE(account_id, discovery_type, discovery_key),
  FOREIGN KEY(account_id) REFERENCES accounts(id)
);

CREATE TABLE IF NOT EXISTS account_relationships (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  relationship_type TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  confidence TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(account_id) REFERENCES accounts(id)
);

CREATE TABLE IF NOT EXISTS account_annotations (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  body TEXT NOT NULL,
  tags_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(account_id) REFERENCES accounts(id)
);

CREATE TABLE IF NOT EXISTS inventory_item_definitions (
  id TEXT PRIMARY KEY,
  item_key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  item_type TEXT NOT NULL,
  stackable INTEGER NOT NULL DEFAULT 0,
  metadata_public_json TEXT NOT NULL DEFAULT '{}',
  metadata_secret_json TEXT NOT NULL DEFAULT '{}',
  steam_mapping_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS inventory_item_instances (
  id TEXT PRIMARY KEY,
  item_definition_id TEXT NOT NULL,
  owner_account_id TEXT,
  backend_custody_state TEXT NOT NULL DEFAULT 'held',
  fictional_custody_json TEXT NOT NULL DEFAULT '{}',
  state_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(item_definition_id) REFERENCES inventory_item_definitions(id),
  FOREIGN KEY(owner_account_id) REFERENCES accounts(id)
);

CREATE TABLE IF NOT EXISTS inventory_balances (
  account_id TEXT NOT NULL,
  item_definition_id TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(account_id, item_definition_id),
  FOREIGN KEY(account_id) REFERENCES accounts(id),
  FOREIGN KEY(item_definition_id) REFERENCES inventory_item_definitions(id)
);

CREATE TABLE IF NOT EXISTS inventory_ledger (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  item_definition_id TEXT,
  item_instance_id TEXT,
  delta_quantity INTEGER,
  operation TEXT NOT NULL,
  provenance_json TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  backend_custody_change_json TEXT NOT NULL DEFAULT '{}',
  fictional_custody_event_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(account_id, idempotency_key),
  FOREIGN KEY(account_id) REFERENCES accounts(id),
  FOREIGN KEY(item_definition_id) REFERENCES inventory_item_definitions(id),
  FOREIGN KEY(item_instance_id) REFERENCES inventory_item_instances(id)
);

CREATE TABLE IF NOT EXISTS inventory_item_history (
  id TEXT PRIMARY KEY,
  item_instance_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  event_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(item_instance_id) REFERENCES inventory_item_instances(id)
);

CREATE TABLE IF NOT EXISTS inventory_relationships (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  source_item_instance_id TEXT,
  source_item_definition_id TEXT,
  relationship_type TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  discovered_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(account_id) REFERENCES accounts(id)
);

CREATE TABLE IF NOT EXISTS archive_state_scopes (
  id TEXT PRIMARY KEY,
  scope_type TEXT NOT NULL,
  scope_key TEXT NOT NULL,
  current_state_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(scope_type, scope_key)
);

CREATE TABLE IF NOT EXISTS archive_state_history (
  id TEXT PRIMARY KEY,
  scope_id TEXT NOT NULL,
  transition_type TEXT NOT NULL,
  previous_state_json TEXT NOT NULL DEFAULT '{}',
  next_state_json TEXT NOT NULL DEFAULT '{}',
  cause_type TEXT NOT NULL,
  cause_id TEXT,
  actor_type TEXT,
  actor_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(scope_id) REFERENCES archive_state_scopes(id)
);

CREATE TABLE IF NOT EXISTS authored_events (
  id TEXT PRIMARY KEY,
  event_key TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL,
  scope_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  required INTEGER NOT NULL DEFAULT 0,
  probability_basis_points INTEGER,
  cooldown_seconds INTEGER,
  starts_at TEXT,
  ends_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS event_eligibility_rules (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  rule_type TEXT NOT NULL,
  rule_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(event_id) REFERENCES authored_events(id)
);

CREATE TABLE IF NOT EXISTS event_effect_definitions (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  effect_type TEXT NOT NULL,
  effect_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(event_id) REFERENCES authored_events(id)
);

CREATE TABLE IF NOT EXISTS legacy_import_batches (
  id TEXT PRIMARY KEY,
  account_id TEXT,
  visitor_label TEXT,
  trust_level TEXT NOT NULL DEFAULT 'untrusted',
  source_summary_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'created',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(account_id) REFERENCES accounts(id)
);

CREATE TABLE IF NOT EXISTS legacy_import_items (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL,
  source_key TEXT NOT NULL,
  source_type TEXT NOT NULL,
  proposed_value_json TEXT NOT NULL DEFAULT '{}',
  trust_decision TEXT NOT NULL DEFAULT 'pending',
  decision_reason TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(batch_id) REFERENCES legacy_import_batches(id)
);


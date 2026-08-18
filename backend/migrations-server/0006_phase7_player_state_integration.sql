CREATE TABLE IF NOT EXISTS player_state_projection_definitions (
  id TEXT PRIMARY KEY,
  subject_type TEXT NOT NULL,
  subject_key TEXT NOT NULL,
  player_label TEXT NOT NULL,
  player_summary TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  public_metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(subject_type, subject_key)
);

CREATE INDEX IF NOT EXISTS idx_player_state_projection_subject
  ON player_state_projection_definitions(subject_type, sort_order, subject_key);

CREATE INDEX IF NOT EXISTS idx_progression_history_player_safe
  ON progression_history(account_id, player_visibility, created_at DESC);

INSERT OR IGNORE INTO operational_modes (mode_key, enabled, reason)
VALUES ('player_surfaces_disabled', 1, 'phase7_default_disabled_until_physical_validation');

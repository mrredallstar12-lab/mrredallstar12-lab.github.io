CREATE TABLE IF NOT EXISTS daily_signals (
  date_key TEXT PRIMARY KEY,
  transmission TEXT NOT NULL,
  artifact TEXT,
  rumor TEXT,
  corrupted_message TEXT,
  reward_json TEXT,
  weather_effect TEXT,
  room_key TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS archive_conditions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  condition_key TEXT NOT NULL,
  label TEXT NOT NULL,
  detail TEXT,
  starts_at TEXT DEFAULT CURRENT_TIMESTAMP,
  ends_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS archive_weather (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  weather_key TEXT NOT NULL,
  label TEXT NOT NULL,
  detail TEXT,
  intensity INTEGER DEFAULT 1,
  starts_at TEXT DEFAULT CURRENT_TIMESTAMP,
  ends_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS activity_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,
  visitor_label TEXT,
  message TEXT NOT NULL,
  payload_json TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_activity_events_created_at ON activity_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_events_type ON activity_events(event_type);

CREATE TABLE IF NOT EXISTS popup_graveyard_totals (
  popup_type TEXT PRIMARY KEY,
  closed_count INTEGER NOT NULL DEFAULT 0,
  last_closed_at TEXT
);

CREATE TABLE IF NOT EXISTS objectives (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  objective_type TEXT NOT NULL,
  target_value INTEGER NOT NULL,
  current_value INTEGER NOT NULL DEFAULT 0,
  reward_json TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  starts_at TEXT DEFAULT CURRENT_TIMESTAMP,
  ends_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS objective_contributions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  objective_id TEXT NOT NULL,
  visitor_hash TEXT NOT NULL,
  amount INTEGER NOT NULL,
  idempotency_key TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(objective_id) REFERENCES objectives(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_objective_contribution_once ON objective_contributions(objective_id, idempotency_key);

CREATE TABLE IF NOT EXISTS creature_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  designation TEXT NOT NULL,
  hunger INTEGER NOT NULL DEFAULT 60,
  mood TEXT NOT NULL DEFAULT 'contained',
  stage INTEGER NOT NULL DEFAULT 1,
  modifiers_json TEXT,
  containment_sensitivity INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS creature_feed (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  visitor_hash TEXT NOT NULL,
  item_name TEXT NOT NULL,
  amount INTEGER NOT NULL DEFAULT 1,
  idempotency_key TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_creature_feed_once ON creature_feed(visitor_hash, idempotency_key);

CREATE TABLE IF NOT EXISTS alchemy_community_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  combo_hash TEXT NOT NULL,
  inputs_json TEXT NOT NULL,
  output_name TEXT,
  result_type TEXT NOT NULL,
  visitor_hash TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_alchemy_combo ON alchemy_community_records(combo_hash);

CREATE TABLE IF NOT EXISTS submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  submission_type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  visitor_hash TEXT,
  moderation_status TEXT NOT NULL DEFAULT 'pending',
  report_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  reviewed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_submissions_status ON submissions(moderation_status, created_at DESC);

CREATE TABLE IF NOT EXISTS case_files (
  id TEXT PRIMARY KEY,
  subject_name TEXT NOT NULL,
  fictional_age TEXT,
  fictional_location TEXT,
  intake_date TEXT,
  status TEXT NOT NULL,
  assigned_employee TEXT,
  summary TEXT NOT NULL,
  restricted INTEGER NOT NULL DEFAULT 0,
  coherence_weight INTEGER NOT NULL DEFAULT 0,
  data_json TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS case_fragments (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL,
  stage_required INTEGER NOT NULL DEFAULT 0,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  data_json TEXT,
  published INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(case_id) REFERENCES case_files(id)
);

CREATE TABLE IF NOT EXISTS case_conclusions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id TEXT NOT NULL,
  question_key TEXT NOT NULL,
  answer_key TEXT NOT NULL,
  visitor_hash TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_case_conclusion_once ON case_conclusions(case_id, question_key, visitor_hash);

CREATE TABLE IF NOT EXISTS rate_limits (
  bucket_key TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0,
  reset_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS admin_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action TEXT NOT NULL,
  detail_json TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);


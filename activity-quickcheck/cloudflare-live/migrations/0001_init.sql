-- Cloudflare D1 schema for the separately hosted Activity QuickCheck service.
-- Student IDs are self-declared, never an official SCUT identity attestation.
CREATE TABLE IF NOT EXISTS activity_users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_salt TEXT NOT NULL,
  password_digest TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('student','organizer')),
  student_number TEXT UNIQUE,
  display_name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS activity_sessions (
  digest TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES activity_users(id),
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS activity_sessions_expiry ON activity_sessions(expires_at);
CREATE TABLE IF NOT EXISTS activity_events (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES activity_users(id),
  title TEXT NOT NULL,
  guidelines TEXT NOT NULL DEFAULT '',
  lat REAL NOT NULL,
  lon REAL NOT NULL,
  radius_m INTEGER NOT NULL,
  starts_at INTEGER NOT NULL,
  ends_at INTEGER NOT NULL,
  require_photo INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS activity_staff (
  event_id TEXT NOT NULL REFERENCES activity_events(id),
  user_id TEXT NOT NULL REFERENCES activity_users(id),
  duty TEXT NOT NULL CHECK(duty IN ('reviewer','scanner','manual')),
  PRIMARY KEY(event_id,user_id)
);
CREATE TABLE IF NOT EXISTS activity_registrations (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES activity_events(id),
  user_id TEXT NOT NULL REFERENCES activity_users(id),
  note TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','approved','rejected')),
  review_reason TEXT NOT NULL DEFAULT '',
  reviewed_by TEXT REFERENCES activity_users(id),
  reviewed_at INTEGER,
  updated_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  ai_consent INTEGER NOT NULL DEFAULT 0,
  UNIQUE(event_id,user_id)
);
CREATE TABLE IF NOT EXISTS activity_files (
  id TEXT PRIMARY KEY,
  registration_id TEXT NOT NULL REFERENCES activity_registrations(id),
  object_key TEXT NOT NULL UNIQUE,
  mime TEXT NOT NULL CHECK(mime IN ('image/jpeg','image/png')),
  length INTEGER NOT NULL,
  added_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS activity_tickets (
  registration_id TEXT PRIMARY KEY REFERENCES activity_registrations(id),
  digest TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS activity_attendance (
  registration_id TEXT PRIMARY KEY REFERENCES activity_registrations(id),
  event_id TEXT NOT NULL REFERENCES activity_events(id),
  staff_id TEXT NOT NULL REFERENCES activity_users(id),
  channel TEXT NOT NULL CHECK(channel IN ('scan','manual')),
  reason TEXT,
  attended_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS activity_ai_advice (
  id TEXT PRIMARY KEY,
  registration_id TEXT NOT NULL REFERENCES activity_registrations(id),
  reviewer_id TEXT NOT NULL REFERENCES activity_users(id),
  input_updated_at INTEGER NOT NULL,
  result_json TEXT NOT NULL,
  model TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS activity_ai_recent ON activity_ai_advice(registration_id,created_at DESC);
CREATE TABLE IF NOT EXISTS activity_audit (
  id TEXT PRIMARY KEY,
  event_id TEXT REFERENCES activity_events(id),
  actor_id TEXT REFERENCES activity_users(id),
  action TEXT NOT NULL,
  subject_id TEXT,
  occurred_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS activity_registrations_queue ON activity_registrations(event_id,state,updated_at DESC);

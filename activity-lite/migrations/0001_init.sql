-- Lite, pre-deployment schema v2. Only organizers have accounts.
-- Students use a private random receipt link; there are no student users.
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  place TEXT NOT NULL,
  instructions TEXT NOT NULL DEFAULT '',
  starts_at INTEGER NOT NULL,
  ends_at INTEGER NOT NULL,
  require_material INTEGER NOT NULL CHECK(require_material IN (0,1)),
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS staff_accounts (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id),
  username TEXT NOT NULL,
  display_name TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  password_digest TEXT NOT NULL,
  password_iterations INTEGER NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin','member')),
  can_review INTEGER NOT NULL DEFAULT 0 CHECK(can_review IN (0,1)),
  can_scan INTEGER NOT NULL DEFAULT 0 CHECK(can_scan IN (0,1)),
  can_export INTEGER NOT NULL DEFAULT 0 CHECK(can_export IN (0,1)),
  can_manual INTEGER NOT NULL DEFAULT 0 CHECK(can_manual IN (0,1)),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(event_id, username)
);
CREATE INDEX IF NOT EXISTS lite_staff_event ON staff_accounts(event_id,enabled);
CREATE TABLE IF NOT EXISTS staff_sessions (
  digest TEXT PRIMARY KEY,
  staff_id TEXT NOT NULL REFERENCES staff_accounts(id),
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS lite_staff_session_expiry ON staff_sessions(expires_at);
CREATE TABLE IF NOT EXISTS registrations (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id),
  receipt_digest TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  student_number TEXT NOT NULL,
  contact TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  material_key TEXT,
  material_mime TEXT,
  material_bytes INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
  decision TEXT NOT NULL DEFAULT '',
  reviewed_by TEXT REFERENCES staff_accounts(id),
  checkin_digest TEXT UNIQUE,
  checked_at INTEGER,
  checked_by TEXT CHECK(checked_by IN ('scan','manual')),
  checked_actor_id TEXT REFERENCES staff_accounts(id),
  checkin_reason TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS lite_event_queue ON registrations(event_id,created_at DESC);
CREATE INDEX IF NOT EXISTS lite_status ON registrations(event_id,status,checked_at);
CREATE TABLE IF NOT EXISTS audit (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id),
  registration_id TEXT REFERENCES registrations(id),
  staff_id TEXT REFERENCES staff_accounts(id),
  action TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS lite_audit_event ON audit(event_id,at DESC);

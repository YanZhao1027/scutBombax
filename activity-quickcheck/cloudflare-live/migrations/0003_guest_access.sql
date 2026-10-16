-- Synthetic-only anonymous student registration receipts.
-- Run AFTER 0001_init.sql AND 0002_password_iterations.sql.
-- Existing organizer accounts, legacy student registrations and attendance remain intact.
-- Student identity is self-declared: this is NOT a verified campus identity.
-- Never put the raw receipt in D1, R2, URLs, CSV or logs.
CREATE TABLE IF NOT EXISTS activity_guest_access (
  registration_id TEXT PRIMARY KEY NOT NULL REFERENCES activity_registrations(id),
  event_id TEXT NOT NULL REFERENCES activity_events(id),
  student_number TEXT NOT NULL,
  token_digest TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS activity_guest_access_expiry ON activity_guest_access(expires_at);
CREATE INDEX IF NOT EXISTS activity_guest_access_event ON activity_guest_access(event_id);

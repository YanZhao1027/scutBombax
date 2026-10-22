-- An event-scoped, non-authorizing recovery hint for exceptional check-in.
-- Keep registration identity separate from rotating QR tokens.
-- Existing registrations receive a random reference on their next authenticated read.
ALTER TABLE activity_registrations ADD COLUMN recovery_code TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS activity_recovery_reference
  ON activity_registrations(event_id,recovery_code);

-- Digest only: past QR contents are not stored. Allows a manual exception
-- lookup for a recently expired or consumed QR; never re-enables redemption.
CREATE TABLE IF NOT EXISTS activity_ticket_history (
  digest TEXT PRIMARY KEY,
  registration_id TEXT NOT NULL REFERENCES activity_registrations(id),
  event_id TEXT NOT NULL REFERENCES activity_events(id),
  issued_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS activity_ticket_history_expiry
  ON activity_ticket_history(expires_at);

-- Reasoned staff disclosures. Neither the QR token nor recovery code is logged.
CREATE TABLE IF NOT EXISTS activity_exception_lookup (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES activity_events(id),
  actor_id TEXT NOT NULL REFERENCES activity_users(id),
  registration_id TEXT REFERENCES activity_registrations(id),
  kind TEXT NOT NULL CHECK(kind IN ('recovery','qr')),
  reason_code TEXT NOT NULL,
  reason_note TEXT NOT NULL,
  matched INTEGER NOT NULL CHECK(matched IN (0,1)),
  occurred_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS activity_exception_lookup_audit
  ON activity_exception_lookup(event_id,occurred_at DESC);

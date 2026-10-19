-- Reissuance uses completely new bearer digests while retaining old audit history.
CREATE TABLE IF NOT EXISTS activity_revoked_receipts (
  token_digest TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES activity_events(id),
  old_registration_id TEXT NOT NULL UNIQUE REFERENCES activity_registrations(id),
  new_registration_id TEXT NOT NULL UNIQUE REFERENCES activity_registrations(id),
  revoked_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS activity_revoked_receipts_event ON activity_revoked_receipts(event_id);

-- New multi-role permissions: keep legacy staff table intact for rollback.
CREATE TABLE IF NOT EXISTS activity_staff_grants (
  event_id TEXT NOT NULL REFERENCES activity_events(id),
  user_id TEXT NOT NULL REFERENCES activity_users(id),
  duty TEXT NOT NULL CHECK(duty IN ('reviewer','scanner','manual')),
  updated_at INTEGER NOT NULL,
  granted_by TEXT REFERENCES activity_users(id),
  PRIMARY KEY(event_id,user_id,duty)
);
INSERT OR IGNORE INTO activity_staff_grants(event_id,user_id,duty,updated_at,granted_by)
  SELECT event_id,user_id,duty,0,NULL FROM activity_staff;
CREATE INDEX IF NOT EXISTS activity_staff_grants_user ON activity_staff_grants(user_id,event_id);

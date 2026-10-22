-- Optional future production-only heartbeat table. Do not enable campus routing on Stage.
CREATE TABLE IF NOT EXISTS activity_campus_heartbeat (
 id INTEGER PRIMARY KEY CHECK (id=1),
 release TEXT NOT NULL,
 ready INTEGER NOT NULL CHECK (ready IN (0,1)),
 last_seen_at INTEGER NOT NULL
);

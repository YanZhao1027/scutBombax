-- Separate activity time from the public registration window (additive, nullable).
-- Existing activities continue to accept signup from creation until event end.
ALTER TABLE activity_events ADD COLUMN join_starts_at INTEGER;
ALTER TABLE activity_events ADD COLUMN join_ends_at INTEGER;

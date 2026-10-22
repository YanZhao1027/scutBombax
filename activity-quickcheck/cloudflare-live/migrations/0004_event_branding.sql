-- 0004: per-event enrollment period and SVG illustration options.
-- Existing synthetic events keep their original behavior via COALESCE.
-- Apply to isolated Stage D1 only after a verified backup.
ALTER TABLE activity_events ADD COLUMN registration_opens_at INTEGER;
ALTER TABLE activity_events ADD COLUMN registration_closes_at INTEGER;
ALTER TABLE activity_events ADD COLUMN banner_template TEXT NOT NULL DEFAULT 'music';
ALTER TABLE activity_events ADD COLUMN banner_key TEXT;
CREATE INDEX IF NOT EXISTS activity_events_registration_window ON activity_events(registration_opens_at,registration_closes_at);

-- Select a useful theme for older synthetic events without touching signups.
UPDATE activity_events SET banner_template=CASE
 WHEN title LIKE '%音乐%' OR title LIKE '%演唱%' OR title LIKE '%歌%' THEN 'music'
 WHEN title LIKE '%志愿%' OR title LIKE '%公益%' OR title LIKE '%环保%' THEN 'volunteer'
 WHEN title LIKE '%运动%' OR title LIKE '%球%' OR title LIKE '%体育%' THEN 'sports'
 WHEN title LIKE '%科创%' OR title LIKE '%科技%' OR title LIKE '%学术%' THEN 'science'
 ELSE 'festival' END
 WHERE banner_key IS NULL;

-- Record the PBKDF2 iteration count so staged credentials can be migrated safely.
-- Old development accounts used 240000, which exceeds Cloudflare Workers Web Crypto's 100000 limit.
ALTER TABLE activity_users ADD COLUMN password_iterations INTEGER NOT NULL DEFAULT 240000;

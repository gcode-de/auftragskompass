-- Feeds are revocable by deleting them, not by running out of time.
ALTER TABLE calendar_feeds ALTER COLUMN expires_at DROP NOT NULL;
ALTER TABLE calendar_feeds ALTER COLUMN expires_at DROP DEFAULT;
UPDATE calendar_feeds SET expires_at = NULL;

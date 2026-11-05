ALTER TABLE telegram_settings ADD COLUMN topic_id text;
ALTER TABLE telegram_settings ADD CONSTRAINT telegram_topic_id_valid
  CHECK (topic_id IS NULL OR topic_id ~ '^[1-9][0-9]{0,14}$');

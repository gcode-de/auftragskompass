ALTER TABLE reservations ADD COLUMN block_reason text NOT NULL DEFAULT ''
 CHECK(length(block_reason)<=200);
ALTER TABLE reservations ADD CONSTRAINT block_reason_internal_only
 CHECK(block_reason='' OR event_id IS NULL);

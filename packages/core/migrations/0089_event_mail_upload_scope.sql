ALTER TABLE library_files
  ADD COLUMN scoped_event_id uuid,
  ADD CONSTRAINT library_files_scoped_event_fk
    FOREIGN KEY (tenant_id, scoped_event_id) REFERENCES events (tenant_id, id);

CREATE INDEX library_files_scoped_event
  ON library_files (tenant_id, scoped_event_id, uploaded_at DESC)
  WHERE scoped_event_id IS NOT NULL;

CREATE OR REPLACE FUNCTION mail_file_reference_available() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  attachment_event uuid;
BEGIN
  IF TG_TABLE_NAME = 'mail_file_attachments' THEN
    SELECT m.event_id INTO attachment_event
      FROM mail_messages m
     WHERE m.tenant_id = NEW.tenant_id AND m.id = NEW.message_id;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM library_files f
     WHERE f.tenant_id = NEW.tenant_id AND f.id = NEW.library_file_id
       AND f.state = 'available' AND f.scan_state = 'not_scanned'
       AND (f.scoped_event_id IS NULL OR f.scoped_event_id = attachment_event)
  ) THEN
    RAISE EXCEPTION 'mail file attachment is not available';
  END IF;
  RETURN NEW;
END $$;

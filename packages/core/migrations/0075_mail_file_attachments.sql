-- MAIL-TPL-01d: standard file attachments from the tenant library. Additive
-- only: two new tables and no change to any existing row - the document
-- attachment contract (mail_attachments) including its "final documents
-- only" trigger stays byte-identical.
--
-- A template names its standard attachments; a mail carries a frozen
-- reference (storage key, hash, size) per chosen file, so the worker reads
-- exactly the bytes that existed when the order was made. The display name
-- never becomes a path or a MIME header as typed: the server generates the
-- stored file name from it.
CREATE TABLE mail_template_attachments (
 tenant_id uuid NOT NULL REFERENCES tenants(id),
 template_id uuid NOT NULL,
 library_file_id uuid NOT NULL,
 position integer NOT NULL DEFAULT 0 CHECK(position>=0),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,template_id,library_file_id),
 FOREIGN KEY(tenant_id,template_id) REFERENCES mail_templates(tenant_id,id) ON DELETE CASCADE,
 FOREIGN KEY(tenant_id,library_file_id) REFERENCES library_files(tenant_id,id) ON DELETE RESTRICT
);
-- A template may only reference an available file in the current scan state
-- (0038: 'not_scanned' is the only value until a scanner exists; every other
-- value must keep mail attachments blocked).
CREATE FUNCTION mail_file_reference_available() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM library_files f
     WHERE f.tenant_id=NEW.tenant_id AND f.id=NEW.library_file_id
       AND f.state='available' AND f.scan_state='not_scanned'
  ) THEN
    RAISE EXCEPTION 'mail file attachment is not available';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER mail_template_attachment_available
  BEFORE INSERT OR UPDATE ON mail_template_attachments
  FOR EACH ROW EXECUTE FUNCTION mail_file_reference_available();

CREATE TABLE mail_file_attachments (
 tenant_id uuid NOT NULL REFERENCES tenants(id),
 message_id uuid NOT NULL,
 library_file_id uuid NOT NULL,
 -- Server-generated from the display name; only safe characters, never a
 -- path, never operator input verbatim.
 filename text NOT NULL CHECK(filename ~ '^[A-Za-z0-9._-]{1,121}$'),
 media_type text NOT NULL
   CHECK(media_type IN ('application/pdf','image/png','image/jpeg','application/zip')),
 size_bytes bigint NOT NULL CHECK(size_bytes BETWEEN 1 AND 10485760),
 -- Frozen at order time: the worker reads exactly this key again.
 storage_key text NOT NULL CHECK(storage_key ~ '^[a-z0-9][a-z0-9._-]{0,127}$'),
 -- The hash of the referenced bytes; every attempt verifies it, so a
 -- replaced or corrupted store is a named failure and never a wrong file.
 sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,message_id,library_file_id),
 FOREIGN KEY(tenant_id,message_id) REFERENCES mail_messages(tenant_id,id) ON DELETE CASCADE,
 FOREIGN KEY(tenant_id,library_file_id) REFERENCES library_files(tenant_id,id) ON DELETE RESTRICT
);
CREATE TRIGGER mail_file_attachment_available
  BEFORE INSERT OR UPDATE ON mail_file_attachments
  FOR EACH ROW EXECUTE FUNCTION mail_file_reference_available();

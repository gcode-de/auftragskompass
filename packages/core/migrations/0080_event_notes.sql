-- QW3: dated notes per event replace the single notes field, like Bookitup.
-- Each note keeps its author and creation time; removal is a tombstone so the
-- history survives. Existing single notes move into one note each (dated at
-- the migration, author unknown) and the old column is emptied; it stays for
-- the unchanged event API contract, and new writes to it become notes.
CREATE TABLE event_notes (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  event_id uuid NOT NULL,
  body_html text NOT NULL CHECK (length(body_html) BETWEEN 1 AND 20000),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  deleted_at timestamptz,
  deleted_by uuid,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, event_id) REFERENCES events (tenant_id, id),
  FOREIGN KEY (tenant_id, created_by) REFERENCES users (tenant_id, id),
  FOREIGN KEY (tenant_id, deleted_by) REFERENCES users (tenant_id, id),
  CHECK ((deleted_at IS NULL) = (deleted_by IS NULL))
);
CREATE INDEX event_notes_event_idx
  ON event_notes (tenant_id, event_id, created_at DESC)
  WHERE deleted_at IS NULL;

INSERT INTO event_notes (tenant_id, id, event_id, body_html)
SELECT tenant_id, gen_random_uuid(), id, notes_html
  FROM events
 WHERE btrim(regexp_replace(notes_html, '<[^>]*>|&nbsp;', '', 'g')) <> '';
UPDATE events SET notes_html = '' WHERE notes_html <> '';

ALTER TABLE audit_events DROP CONSTRAINT audit_events_action_check;
ALTER TABLE audit_events ADD CONSTRAINT audit_events_action_check CHECK(action IN (
 'login.succeeded','login.denied','login.failed','logout','master_data.created','master_data.updated',
 'resource.created','resource.updated','product.created','product.updated','product.deleted','contact.created','contact.updated',
 'location.created','location.updated','event.created','event.updated','reservation.created','reservation.updated','reservation.expired',
 'import.created','import.updated','import.reviewed','password.changed','password.change_denied','password.reset',
 'feed.created','feed.rotated','feed.revoked',
 'document_template.created','document_template.updated',
 'document_number.updated','document_layout.updated',
 'document.created','document.updated','document.finalized',
 'document.sent','document.accepted','document.withdrawn','document.acceptance_corrected',
 'file.uploaded','file.archived','payment.recorded','file.event_linked','file.event_unlinked',
 'event.removed','event.restored',
 'mail.message_created','mail.send_scheduled',
 'mail.sent','mail.send_retry',
 'mail.document_send_scheduled','mail.account_saved',
 'mail.template_saved','mail.signature_saved',
 'event_note.created','event_note.removed'
));

-- UI-BKP-04: like Bookitup an event note stays editable after it was written.
-- The note keeps its creation time and author; the last edit is recorded
-- beside it, and the edit is its own audit action.
ALTER TABLE event_notes
  ADD COLUMN updated_at timestamptz,
  ADD COLUMN updated_by uuid,
  ADD CONSTRAINT event_notes_updated_by_fk
    FOREIGN KEY (tenant_id, updated_by) REFERENCES users (tenant_id, id),
  ADD CONSTRAINT event_notes_update_pair_check
    CHECK ((updated_at IS NULL) = (updated_by IS NULL));
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
 'event_note.created','event_note.removed',
 'mail.send_cancelled',
 'event_note.updated'
));

-- Catalogue removal preserves existing foreign keys and document snapshots.
ALTER TABLE contacts
  ADD COLUMN deleted_at timestamptz,
  ADD CONSTRAINT contacts_deleted_archived CHECK (deleted_at IS NULL OR state = 'archived');
ALTER TABLE products
  ADD COLUMN deleted_at timestamptz,
  ADD CONSTRAINT products_deleted_archived CHECK (deleted_at IS NULL OR state = 'archived');

ALTER TABLE audit_events DROP CONSTRAINT audit_events_action_check;
ALTER TABLE audit_events ADD CONSTRAINT audit_events_action_check CHECK(action IN (
 'login.succeeded','login.denied','login.failed','logout','master_data.created','master_data.updated',
 'resource.created','resource.updated','product.created','product.updated','product.deleted','contact.created','contact.updated','contact.deleted',
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
 'event_note.updated',
 'resource_category.created','resource_category.updated','resource_category.deleted',
 'resource_settings.updated'
));

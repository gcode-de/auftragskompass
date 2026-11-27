-- Withdrawn orders keep their receipt so an old send request cannot start again.
ALTER TABLE mail_outbox DROP CONSTRAINT mail_outbox_state_check;
ALTER TABLE mail_outbox ADD CONSTRAINT mail_outbox_state_check
  CHECK (state IN ('pending','sending','sent','failed','uncertain','cancelled'));

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
 'mail.message_created','mail.message_edited','mail.message_moved','mail.send_rescheduled','mail.send_scheduled',
 'mail.sent','mail.send_retry',
 'mail.document_send_scheduled','mail.account_saved',
 'mail.template_saved','mail.signature_saved',
 'event_note.created','event_note.removed',
 'mail.send_cancelled',
 'event_note.updated',
 'resource_category.created','resource_category.updated','resource_category.deleted',
 'resource_settings.updated'
));

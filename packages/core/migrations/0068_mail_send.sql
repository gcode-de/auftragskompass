-- MAIL-021-B: additive only, no table, no column and no row changes. Two closed
-- vocabularies live in the database and must be widened, not bypassed:
--   1. the audit action list (0052/0064/0066/0067 pattern): an accepted message
--      and the deliberate repetition of an unclear attempt are their own events;
--   2. the redacted outbox error codes: authentication, a rejected recipient and
--      a missing key are different operator actions and must stay distinguishable.
-- Every earlier action and every earlier code keeps its meaning.
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
 'mail.sent','mail.send_retry'
));
ALTER TABLE mail_outbox DROP CONSTRAINT mail_outbox_last_error_code_check;
ALTER TABLE mail_outbox ADD CONSTRAINT mail_outbox_last_error_code_check
  CHECK(last_error_code IS NULL OR last_error_code IN
    ('provider_missing','provider_timeout','provider_rejected','provider_uncertain','internal',
     'provider_auth_failed','provider_recipient_rejected','encryption_unavailable'));

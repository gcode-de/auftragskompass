-- MAIL-ACCOUNT-01: the sending identity and the transport choice of a mail
-- account. Additive only: every existing row keeps its data, and the stored
-- defaults mean "STARTTLS with no invented sender identity".
ALTER TABLE mail_accounts
  ADD COLUMN from_name text NOT NULL DEFAULT '' CHECK(length(from_name)<=200),
  ADD COLUMN from_address text NOT NULL DEFAULT '' CHECK(length(from_address)<=254),
  ADD COLUMN smtp_security text NOT NULL DEFAULT 'starttls',
  -- 'none' protects no credential on the wire, so it is only for a relay
  -- without a username (MAIL-021-B2: a configured password always travels
  -- under TLS).
  ADD CONSTRAINT mail_accounts_smtp_security_check
    CHECK(smtp_security IN ('starttls','implicit','none')
          AND (smtp_security <> 'none' OR username = ''));
-- One widened closed vocabulary in the established 0052/0064/0066/0067/0068/
-- 0071 pattern; every earlier action keeps its meaning, one is added.
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
 'mail.document_send_scheduled','mail.account_saved'
));

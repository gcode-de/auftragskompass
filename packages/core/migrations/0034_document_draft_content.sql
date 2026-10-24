ALTER TABLE documents
  ADD COLUMN subject text,
  ADD COLUMN intro_text text,
  ADD COLUMN outro_text text,
  ADD COLUMN validity_days integer,
  ADD CONSTRAINT documents_draft_content_lengths CHECK (
    (subject IS NULL AND intro_text IS NULL AND outro_text IS NULL AND validity_days IS NULL)
    OR
    (subject IS NOT NULL AND length(subject) <= 200
      AND intro_text IS NOT NULL AND length(intro_text) <= 4000
      AND outro_text IS NOT NULL AND length(outro_text) <= 4000
      AND validity_days IS NOT NULL AND validity_days BETWEEN 1 AND 365)
  );

ALTER TABLE audit_events DROP CONSTRAINT audit_events_action_check;
ALTER TABLE audit_events ADD CONSTRAINT audit_events_action_check CHECK(action IN (
 'login.succeeded','login.denied','login.failed','logout','master_data.created','master_data.updated',
 'resource.created','resource.updated','product.created','product.updated','contact.created','contact.updated',
 'location.created','location.updated','event.created','event.updated','reservation.created','reservation.updated','reservation.expired',
 'import.created','import.updated','import.reviewed','password.changed','password.change_denied','password.reset',
 'feed.created','feed.rotated','feed.revoked',
 'document_template.created','document_template.updated',
 'document_number.updated','document_layout.updated',
 'document.created','document.updated','document.finalized'
));

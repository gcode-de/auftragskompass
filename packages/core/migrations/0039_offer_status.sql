-- BKP019.0: an offer carries two independent axes. `state` stays the content
-- maturity (draft|final|withdrawn) and keeps every existing contract; the
-- business status of an offer is its own nullable column. `expired` is never
-- stored: it is derived from `valid_until` in the tenant time zone, so no
-- worker and no silent write can ever disagree with the printed deadline.
ALTER TABLE documents
  -- The deadline the PDF prints, frozen once at finalization. NULL for every
  -- non-offer and every draft, so nobody has to invent a date.
  ADD COLUMN valid_until date,
  -- NULL means "no status claim yet" (final, never sent). It is also the honest
  -- value for every row that existed before this slice.
  ADD COLUMN offer_status text,
  ADD COLUMN status_changed_at timestamptz;

-- A deadline exists only where it is printed: on a final offer.
ALTER TABLE documents ADD CONSTRAINT documents_valid_until_check CHECK (
  valid_until IS NULL OR (kind = 'offer' AND state = 'final')
);
-- Only offers have a business status, and only once their content is final.
ALTER TABLE documents ADD CONSTRAINT documents_offer_status_check CHECK (
  offer_status IS NULL
  OR (kind = 'offer' AND state = 'final' AND offer_status IN ('sent', 'accepted', 'withdrawn'))
);
-- A status without its instant (or an instant without a status) is a lie.
ALTER TABLE documents ADD CONSTRAINT documents_status_changed_check CHECK (
  (offer_status IS NULL) = (status_changed_at IS NULL)
);
CREATE INDEX documents_offer_validity ON documents (tenant_id, kind, valid_until);

-- Data-preserving backfill: replay exactly the deadline today's rendering
-- prints for a final offer (issued_at in the tenant zone plus the stored days).
-- Everything else stays NULL instead of guessing.
UPDATE documents d
   SET valid_until = ((d.issued_at AT TIME ZONE t.timezone)::date + d.validity_days)
  FROM tenants t
 WHERE t.id = d.tenant_id
   AND d.kind = 'offer'
   AND d.state = 'final'
   AND d.validity_days IS NOT NULL;

ALTER TABLE audit_events DROP CONSTRAINT audit_events_action_check;
ALTER TABLE audit_events ADD CONSTRAINT audit_events_action_check CHECK(action IN (
 'login.succeeded','login.denied','login.failed','logout','master_data.created','master_data.updated',
 'resource.created','resource.updated','product.created','product.updated','contact.created','contact.updated',
 'location.created','location.updated','event.created','event.updated','reservation.created','reservation.updated','reservation.expired',
 'import.created','import.updated','import.reviewed','password.changed','password.change_denied','password.reset',
 'feed.created','feed.rotated','feed.revoked',
 'document_template.created','document_template.updated',
 'document_number.updated','document_layout.updated',
 'document.created','document.updated','document.finalized',
 'document.sent','document.accepted','document.withdrawn',
 'file.uploaded','file.archived'
));

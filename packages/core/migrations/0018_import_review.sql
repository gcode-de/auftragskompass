ALTER TABLE import_promises
 ADD COLUMN reviewed_at timestamptz,
 ADD COLUMN reviewed_by uuid,
 ADD COLUMN review_hash text,
 ADD COLUMN review_action text,
 ADD COLUMN reviewed_event_id uuid,
 ADD FOREIGN KEY(tenant_id,reviewed_by) REFERENCES users(tenant_id,id),
 ADD FOREIGN KEY(tenant_id,reviewed_event_id) REFERENCES events(tenant_id,id),
 ADD CONSTRAINT import_review_complete CHECK(
  (reviewed_at IS NULL AND reviewed_by IS NULL AND review_hash IS NULL AND review_action IS NULL AND reviewed_event_id IS NULL) OR
  (reviewed_at IS NOT NULL AND reviewed_by IS NOT NULL AND review_hash IS NOT NULL AND review_hash ~ '^[0-9a-f]{64}$' AND
    ((review_action IS NOT DISTINCT FROM 'event' AND reviewed_event_id IS NOT NULL) OR
     (review_action IS NOT DISTINCT FROM 'excluded_past' AND reviewed_event_id IS NULL)))
 );
ALTER TABLE audit_events DROP CONSTRAINT audit_events_action_check;
ALTER TABLE audit_events ADD CONSTRAINT audit_events_action_check CHECK(action IN (
 'login.succeeded','login.denied','login.failed','logout','master_data.created','master_data.updated',
 'resource.created','resource.updated','product.created','product.updated','contact.created','contact.updated',
 'location.created','location.updated','event.created','event.updated','reservation.created','reservation.updated','reservation.expired',
 'import.created','import.updated','import.reviewed'
));

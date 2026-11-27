-- Keep source credits on accepted address suggestions without changing manual rows.
ALTER TABLE contacts ADD COLUMN address_attribution varchar(240);
ALTER TABLE locations ADD COLUMN address_attribution varchar(240);

-- Subscribers must accept the new representation of already linked places.
UPDATE calendar_revisions AS revisions
SET revision = revisions.revision + 1, changed_at = clock_timestamp()
WHERE EXISTS (
  SELECT 1
  FROM events
  WHERE events.tenant_id = revisions.tenant_id
    AND events.deleted_at IS NULL
    AND events.location_id IS NOT NULL
    AND events.event_date IS NOT NULL
    AND events.venue_override
    AND NULLIF(btrim(events.venue), '') IS NOT NULL
);

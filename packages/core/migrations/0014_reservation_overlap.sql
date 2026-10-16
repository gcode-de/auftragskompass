-- Equality for tenant/unit UUIDs and overlap for buffered, half-open UTC ranges.
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE reservations ADD CONSTRAINT reservations_no_overlap
 EXCLUDE USING gist (
  tenant_id WITH =,
  unit_id WITH =,
  tstzrange(starts_at,ends_at,'[)') WITH &&
 ) WHERE (state IN ('booked','blocked'));

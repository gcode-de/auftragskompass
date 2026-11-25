-- QW2 (C071): a cancelled event may name one cancellation reason from the
-- tenant's master data. The generated kind column keeps the reference on
-- cancellation reasons only, and a reason exists only while the event is
-- cancelled.
ALTER TABLE events
  ADD COLUMN cancellation_reason_id uuid,
  ADD COLUMN cancellation_reason_kind text GENERATED ALWAYS AS ('cancellation_reason'::text) STORED,
  ADD CONSTRAINT events_cancellation_reason_fk
    FOREIGN KEY (tenant_id, cancellation_reason_id, cancellation_reason_kind)
    REFERENCES master_data (tenant_id, id, kind),
  ADD CONSTRAINT events_cancellation_reason_status_check
    CHECK (cancellation_reason_id IS NULL OR status = 'cancelled');

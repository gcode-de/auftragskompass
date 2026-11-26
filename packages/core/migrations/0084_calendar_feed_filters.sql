-- Calendar feeds filter by booking status and event type, and may carry the
-- contact and the event notes for the on-site view. Existing feeds keep
-- their link and now leave cancelled and unavailable events out, like the
-- event list does by default.
ALTER TABLE calendar_feeds
  ADD COLUMN statuses text[] NOT NULL
    DEFAULT ARRAY['inquiry','option','booked']::text[],
  ADD COLUMN event_type_ids uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
  ADD COLUMN contact boolean NOT NULL DEFAULT false,
  ADD COLUMN notes boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT calendar_feeds_statuses_check CHECK (
    cardinality(statuses) BETWEEN 1 AND 5
    AND statuses <@ ARRAY['inquiry','option','booked','unavailable','cancelled']::text[]
  ),
  ADD CONSTRAINT calendar_feeds_event_types_check CHECK (
    cardinality(event_type_ids) <= 100
  );

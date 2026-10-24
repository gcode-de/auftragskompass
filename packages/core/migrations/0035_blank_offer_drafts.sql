ALTER TABLE documents ALTER COLUMN template_id DROP NOT NULL;
ALTER TABLE documents ADD CONSTRAINT documents_blank_offer_context CHECK (
  template_id IS NOT NULL OR (
    kind = 'offer'
    AND event_id IS NOT NULL
    AND contact_id IS NOT NULL
    AND subject IS NOT NULL
    AND intro_text IS NOT NULL
    AND outro_text IS NOT NULL
    AND validity_days IS NOT NULL
  )
);

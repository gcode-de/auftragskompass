-- BKP019.b: an accepted offer becomes an order confirmation without retyping a
-- single position. The copy is its own document; this column is the durable
-- link back to the offer it was confirmed from.
--
-- Deliberately generic in name: (c) will reuse the same column for invoices and
-- widen the CHECK itself, so no second link column is ever needed.
ALTER TABLE documents ADD COLUMN source_document_id uuid;

-- Only a confirmation is derived from another document today.
ALTER TABLE documents ADD CONSTRAINT documents_source_kind_check CHECK (
  source_document_id IS NULL OR kind = 'order_confirmation'
);

-- The source is a document of this same tenant, never another tenant's row -
-- the composite key makes a cross-tenant id a plain foreign-key violation.
ALTER TABLE documents ADD CONSTRAINT documents_source_document_fk
  FOREIGN KEY (tenant_id, source_document_id) REFERENCES documents (tenant_id, id);

-- Exactly one confirmation per offer, and for good: a withdrawn confirmation
-- still owns its link, so a replacement has to be decided in (c) or later
-- instead of being created silently.
CREATE UNIQUE INDEX documents_one_order_confirmation
  ON documents (tenant_id, source_document_id)
  WHERE kind = 'order_confirmation';

-- BKP019.b: a confirmation carries no template - it is copied from an offer -
-- so the blank-document rule has to name its kind. Completeness is not widened:
-- event, contact and texts stay mandatory. `invoice` without a template stays
-- refused, exactly as tests/integration/documents.test.ts pins it.
ALTER TABLE documents DROP CONSTRAINT documents_blank_offer_context;
ALTER TABLE documents ADD CONSTRAINT documents_blank_offer_context CHECK (
  template_id IS NOT NULL OR (
    kind IN ('offer', 'order_confirmation')
    AND event_id IS NOT NULL
    AND contact_id IS NOT NULL
    AND subject IS NOT NULL
    AND intro_text IS NOT NULL
    AND outro_text IS NOT NULL
    AND validity_days IS NOT NULL
  )
);

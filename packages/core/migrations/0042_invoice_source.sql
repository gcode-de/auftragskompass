-- BKP019.c1: a finalized order confirmation becomes an invoice. The link column
-- of 0041 is reused unchanged - only the kind list grows, so the chain
-- offer -> confirmation -> invoice keeps exactly one column and one FK.
ALTER TABLE documents DROP CONSTRAINT documents_source_kind_check;
ALTER TABLE documents ADD CONSTRAINT documents_source_kind_check CHECK (
  source_document_id IS NULL OR kind IN ('order_confirmation', 'invoice')
);

-- Exactly one invoice per confirmation, and for good: a finalized invoice is
-- never replaced. A wrong invoice is corrected by a later correction document
-- (BKP019.c2), never by a second invoice or by rewriting the first one.
CREATE UNIQUE INDEX documents_one_invoice
  ON documents (tenant_id, source_document_id)
  WHERE kind = 'invoice';

-- The blank-document rule keeps naming the kind that may live without a
-- template. An invoice without a template is only allowed when it was copied
-- from a confirmation - a blank invoice stays refused, exactly as
-- tests/integration/documents.test.ts pins it. Completeness is not widened:
-- event, contact and texts stay mandatory.
ALTER TABLE documents DROP CONSTRAINT documents_blank_offer_context;
ALTER TABLE documents ADD CONSTRAINT documents_blank_offer_context CHECK (
  template_id IS NOT NULL OR (
    kind IN ('offer', 'order_confirmation', 'invoice')
    AND event_id IS NOT NULL
    AND contact_id IS NOT NULL
    AND subject IS NOT NULL
    AND intro_text IS NOT NULL
    AND outro_text IS NOT NULL
    AND validity_days IS NOT NULL
    AND (kind <> 'invoice' OR source_document_id IS NOT NULL)
  )
);

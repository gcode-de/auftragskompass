-- Regular invoices can start without a template or source, with the same
-- complete event, contact and text context as other template-less documents.
ALTER TABLE documents DROP CONSTRAINT documents_blank_offer_context;
ALTER TABLE documents ADD CONSTRAINT documents_blank_offer_context CHECK (
  template_id IS NOT NULL OR (
    kind IN ('offer', 'order_confirmation', 'invoice', 'correction', 'deposit_invoice')
    AND event_id IS NOT NULL
    AND contact_id IS NOT NULL
    AND subject IS NOT NULL
    AND intro_text IS NOT NULL
    AND outro_text IS NOT NULL
    AND validity_days IS NOT NULL
    AND (kind <> 'correction' OR source_document_id IS NOT NULL)
    AND (kind <> 'deposit_invoice' OR source_document_id IS NOT NULL)
  )
);
ALTER TABLE documents ADD CONSTRAINT documents_final_invoice_source_check CHECK (
  invoice_role IS NULL OR source_document_id IS NOT NULL
);

-- Preserve the idempotency key for the lifetime of the document.
ALTER TABLE documents ADD COLUMN blank_invoice_request_id uuid;
ALTER TABLE documents ADD CONSTRAINT documents_blank_invoice_request_check CHECK (
  blank_invoice_request_id IS NULL OR (
    kind = 'invoice'
    AND invoice_role IS NULL
    AND template_id IS NULL
    AND source_document_id IS NULL
  )
);
CREATE UNIQUE INDEX documents_blank_invoice_request_unique
  ON documents (tenant_id, blank_invoice_request_id)
  WHERE blank_invoice_request_id IS NOT NULL;

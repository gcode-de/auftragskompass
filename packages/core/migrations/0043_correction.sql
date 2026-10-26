-- BKP019.c2: a finalized invoice (or order confirmation) is corrected by its
-- own follow-up document. The correction carries its direction on the document,
-- never as a sign on an amount: every stored sum stays a non-negative magnitude
-- in minor units, so the money contracts of BKP019.0/.a/.b/.c1 stay untouched -
-- no negative line, no negative total, no second rounding. The signed amount is
-- `-1 x` the stored one, and that is exact by construction.
--
-- `credit` is a credit note (it reduces the claim), `debit` is a follow-up
-- charge (it raises it). One direction per document: a mixed correction is two
-- documents, which keeps every printed sum readable.
ALTER TABLE documents ADD COLUMN correction_direction text;

-- A correction without a direction is not a document, and no other kind may
-- carry one. The equality also makes `correction` structurally unable to exist
-- without its direction.
ALTER TABLE documents ADD CONSTRAINT documents_correction_direction_check CHECK (
  (kind = 'correction') = (correction_direction IS NOT NULL)
  AND (
    correction_direction IS NULL
    OR correction_direction IN ('credit', 'debit')
  )
);

-- A correction always belongs to a source document: there is no blank
-- correction and no correction from a template. The source kind and its state
-- are decided by the application (invoice or order confirmation, both final);
-- the database guarantees that a link exists at all.
ALTER TABLE documents ADD CONSTRAINT documents_correction_source_check CHECK (
  kind <> 'correction' OR source_document_id IS NOT NULL
);

-- The one link column of 0041 keeps serving every derived document, so only the
-- kind list grows again.
ALTER TABLE documents DROP CONSTRAINT documents_source_kind_check;
ALTER TABLE documents ADD CONSTRAINT documents_source_kind_check CHECK (
  source_document_id IS NULL
  OR kind IN ('order_confirmation', 'invoice', 'correction')
);

-- At most one open correction draft per source: a double click cannot open two.
-- Finalized corrections are deliberately not unique - partial credit notes are
-- legitimate, and their sum is limited by the application instead.
CREATE UNIQUE INDEX documents_one_open_correction
  ON documents (tenant_id, source_document_id)
  WHERE kind = 'correction' AND state = 'draft';

-- The blank-document rule grows additively: the `invoice` clause of 0042 stays
-- word for word, `correction` gets the same source requirement. A blank
-- correction without a source is still refused with 23514, exactly like a blank
-- invoice, and completeness (event, contact, texts) is not widened.
ALTER TABLE documents DROP CONSTRAINT documents_blank_offer_context;
ALTER TABLE documents ADD CONSTRAINT documents_blank_offer_context CHECK (
  template_id IS NOT NULL OR (
    kind IN ('offer', 'order_confirmation', 'invoice', 'correction')
    AND event_id IS NOT NULL
    AND contact_id IS NOT NULL
    AND subject IS NOT NULL
    AND intro_text IS NOT NULL
    AND outro_text IS NOT NULL
    AND validity_days IS NOT NULL
    AND (kind <> 'invoice' OR source_document_id IS NOT NULL)
    AND (kind <> 'correction' OR source_document_id IS NOT NULL)
  )
);

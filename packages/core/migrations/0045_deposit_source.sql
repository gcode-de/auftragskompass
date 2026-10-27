-- BKP019.c3.1: a finalized order confirmation can be invoiced in advance. The
-- advance is a document of its own kind with its own number circle (`AZ-`,
-- configured since 0027) and it points at the confirmation it belongs to, so the
-- chain offer -> confirmation -> deposit stays one column and one FK.
--
-- The one link column of 0041 keeps serving every derived document, so only the
-- kind list grows again - exactly like 0042 for the invoice and 0043 for the
-- correction.
ALTER TABLE documents DROP CONSTRAINT documents_source_kind_check;
ALTER TABLE documents ADD CONSTRAINT documents_source_kind_check CHECK (
  source_document_id IS NULL
  OR kind IN (
    'order_confirmation',
    'invoice',
    'correction',
    'deposit_invoice'
  )
);

-- There is deliberately NO unique index for deposit invoices: several partial
-- advances on one order are the normal case (30 % now, 20 % later), and a second
-- instalment must stay storable. Unlike the one-invoice rule of 0042, a double
-- click is therefore stopped in the application (the saving guard of the
-- document list) and not by the database.
--
-- The correction rule of 0043 needs no new constraint here: a correction must
-- carry a source (0043), and a deposit invoice is now a legal source kind
-- because it may carry one. Whether that source is final and correctable stays
-- an application rule under the tenant lock, because a CHECK cannot read the
-- other row - the same reason 0043 gives for the invoice.

-- The blank-document rule grows additively again: the `invoice` and `correction`
-- clauses of 0042/0043 stay word for word, `deposit_invoice` gets the same
-- source requirement. A blank advance without a confirmation is still refused
-- with 23514, exactly like a blank invoice, and completeness (event, contact,
-- texts) is not widened: a deposit is only legal when it was copied from a
-- confirmation or comes from a template.
ALTER TABLE documents DROP CONSTRAINT documents_blank_offer_context;
ALTER TABLE documents ADD CONSTRAINT documents_blank_offer_context CHECK (
  template_id IS NOT NULL OR (
    kind IN (
      'offer',
      'order_confirmation',
      'invoice',
      'correction',
      'deposit_invoice'
    )
    AND event_id IS NOT NULL
    AND contact_id IS NOT NULL
    AND subject IS NOT NULL
    AND intro_text IS NOT NULL
    AND outro_text IS NOT NULL
    AND validity_days IS NOT NULL
    AND (kind <> 'invoice' OR source_document_id IS NOT NULL)
    AND (kind <> 'correction' OR source_document_id IS NOT NULL)
    AND (kind <> 'deposit_invoice' OR source_document_id IS NOT NULL)
  )
);

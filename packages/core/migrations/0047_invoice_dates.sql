-- RG-07: an invoice names the day its service happened and the payment term it
-- was issued with. All three columns are additive and need no backfill: NULL is
-- the honest value for every row that existed before this slice, so no existing
-- document is touched and no date is invented.
ALTER TABLE documents
  -- The service day an operator typed. A draft keeps the input, a final document
  -- keeps it unchanged - there is no update path once a document is final.
  ADD COLUMN service_date date,
  -- The agreed term in days, the same shape as `validity_days`: the input, not
  -- the deadline. 0 means "due immediately".
  ADD COLUMN payment_term_days integer,
  -- The day the PDF prints, frozen once at finalization from the invoice day in
  -- the tenant time zone plus the term. NULL for every draft, so a due date
  -- before the invoice date is structurally impossible.
  ADD COLUMN due_date date;

-- The three fields belong to the invoice family - an offer, a confirmation or a
-- blank offer has neither a service day nor a payment term, and a correction or
-- an advance prints the same lines as the invoice it belongs to.
ALTER TABLE documents ADD CONSTRAINT documents_service_date_check CHECK (
  service_date IS NULL
  OR kind IN ('invoice', 'deposit_invoice', 'correction')
);
ALTER TABLE documents ADD CONSTRAINT documents_payment_term_days_check CHECK (
  payment_term_days IS NULL
  OR (kind IN ('invoice', 'deposit_invoice', 'correction')
      AND payment_term_days BETWEEN 0 AND 365)
);
-- A deadline exists only where it is printed: on a final invoice that agreed a
-- term (0039 does the same for `valid_until`). Both halves are checked
-- explicitly, because `NULL = 'final'` is NULL and a CHECK only fails on FALSE.
ALTER TABLE documents ADD CONSTRAINT documents_due_date_check CHECK (
  due_date IS NULL
  OR (kind IN ('invoice', 'deposit_invoice', 'correction')
      AND payment_term_days IS NOT NULL
      AND state = 'final')
);

-- No change to `audit_events_action_check`: the draft path already writes
-- `document.updated` and finalization writes `document.finalized`, so these
-- fields need no audit action of their own.

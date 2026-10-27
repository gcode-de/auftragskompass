-- RG-07b: an invoice names the account its money goes to. The column is
-- additive and needs no backfill - NULL is the honest value for every document
-- that existed before this slice, so no existing invoice is touched and no
-- account is invented.
--
-- Deliberately no freeze column: unlike `due_date` there is nothing to compute
-- here, so there is nothing to freeze. The value is frozen structurally instead
-- - the only write path is the draft path, and a final document has none
-- (`updateDraftContent` requires `state = 'draft'`). A second `state` CHECK
-- would only repeat that rule and would have to be widened again later.
ALTER TABLE documents
  -- Free text an operator typed, printed word for word. No IBAN check, no
  -- placeholder, no bank logic: this slice can *show* an account, not judge one.
  ADD COLUMN bank_account text;

-- The account belongs to the invoice family - an offer, a confirmation or a
-- blank offer has nothing to print it under, and a correction or an advance
-- prints the same lines as the invoice it belongs to.
ALTER TABLE documents ADD CONSTRAINT documents_bank_account_check CHECK (
  bank_account IS NULL
  OR (
    kind IN ('invoice', 'deposit_invoice', 'correction')
    -- Bounded and trimmed like every other text this tenant types
    -- (0040 acceptance_note), measured in characters, not bytes.
    AND length(bank_account) BETWEEN 1 AND 500
    AND bank_account = btrim(bank_account)
    -- No control characters except the line break: a printed address block is
    -- allowed to be multi-line, never to smuggle a bell or a delimiter through.
    -- The domain repeats this rule; the database keeps it true for every path.
    AND replace(bank_account, E'\n', '') !~ '[[:cntrl:]]'
  )
);

-- No change to `audit_events_action_check`: the draft path already writes
-- `document.updated` and finalization writes `document.finalized`.

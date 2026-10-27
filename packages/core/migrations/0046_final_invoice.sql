-- BKP019.c3.2: a finalized order confirmation can be billed as the *final*
-- invoice, which settles the advances already billed on the same order.
-- Both columns are additive and need no backfill: NULL means "the ordinary
-- invoice of BKP019.c1", so every existing row keeps its number, its hashes and
-- its bytes without being touched.
ALTER TABLE documents ADD COLUMN invoice_role text;
ALTER TABLE documents ADD COLUMN deposit_applied_minor bigint;

-- The role is a single marker, not a second state axis: there is exactly one
-- known role, and it only ever describes an invoice. Nothing else may carry it.
ALTER TABLE documents ADD CONSTRAINT documents_invoice_role_check CHECK (
  invoice_role IS NULL
  OR (invoice_role = 'final' AND kind = 'invoice')
);

-- The deduction is a magnitude in minor units exactly like every stored amount,
-- and it exists only where a role justifies it: an invoice without the role is a
-- standard invoice and has nothing to settle. The CASE keeps the rule free of
-- SQL's three-valued logic - `NULL = 'final'` is NULL, and a CHECK only fails on
-- FALSE, so a plain OR would let exactly the case through that must be refused.
-- A final invoice starts without the amount: it is frozen at finalization, which
-- the next constraint demands.
ALTER TABLE documents ADD CONSTRAINT documents_deposit_applied_check CHECK (
  CASE
    WHEN invoice_role IS NULL THEN deposit_applied_minor IS NULL
    ELSE deposit_applied_minor IS NULL
         OR deposit_applied_minor BETWEEN 0 AND 9007199254740991
  END
);

-- Frozen means frozen: the deduction is written at finalization, never in a
-- draft whose content - and therefore its amount - can still move.
ALTER TABLE documents ADD CONSTRAINT documents_deposit_applied_final_check CHECK (
  deposit_applied_minor IS NULL OR state = 'final'
);

-- There is deliberately NO change to `documents_one_invoice` (0042): one
-- confirmation carries exactly one invoice, whether it is the standard one or
-- the final one. The index is therefore already the database guarantee for
-- "either standard or final", and a duplicate answer is the established 409.

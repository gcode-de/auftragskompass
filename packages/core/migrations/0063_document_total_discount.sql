-- DOC-PRODUCT-01.5: one discount for the whole document, with an optional note.
-- Additive and NULL-able on purpose: every document written before this
-- migration keeps kind = value = note = NULL, so its stored net/tax/gross, its
-- claim and its bytes keep exactly their old meaning. The discount never changes
-- a position or a stored sum - it only lowers the amount the document asks for.
ALTER TABLE documents
  ADD COLUMN total_discount_kind text,
  ADD COLUMN total_discount_value bigint,
  ADD COLUMN total_discount_note text,
  -- Kind and value are one decision: both NULL (no discount) or both set.
  ADD CONSTRAINT documents_total_discount_pair_check CHECK (
    (total_discount_kind IS NULL) = (total_discount_value IS NULL)
  ),
  ADD CONSTRAINT documents_total_discount_kind_check CHECK (
    total_discount_kind IS NULL OR total_discount_kind IN ('percent', 'amount')
  ),
  ADD CONSTRAINT documents_total_discount_value_check CHECK (
    total_discount_value IS NULL OR total_discount_value >= 0
  ),
  -- 10000 basis points are the whole document; anything above is a typing
  -- mistake, not an amount to clamp.
  ADD CONSTRAINT documents_total_discount_percent_check CHECK (
    total_discount_kind IS DISTINCT FROM 'percent'
    OR total_discount_value <= 10000
  ),
  -- The note follows the printed account and the acceptance note: trimmed, a
  -- documented upper bound, and no control characters except the one real line
  -- break the printer understands. A note without a discount is meaningless.
  ADD CONSTRAINT documents_total_discount_note_check CHECK (
    total_discount_note IS NULL OR (
      total_discount_kind IS NOT NULL
      AND total_discount_note = btrim(total_discount_note)
      AND length(total_discount_note) BETWEEN 1 AND 500
      AND translate(total_discount_note, E'\n', '') !~ '[[:cntrl:]]'
    )
  );

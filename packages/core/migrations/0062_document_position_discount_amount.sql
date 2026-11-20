-- DOC-PRODUCT-01.4: a position may carry its discount as a fixed amount on the
-- stored basis instead of a percentage. Additive and NULL-able on purpose: rows
-- written before this migration keep their percentage meaning
-- (`discount_basis_points`), so no old amount changes by a cent.
ALTER TABLE document_lines
  ADD COLUMN discount_amount_minor bigint,
  ADD CONSTRAINT document_lines_discount_amount_check CHECK (
    discount_amount_minor IS NULL OR discount_amount_minor >= 0
  );

ALTER TABLE document_template_positions
  ADD COLUMN discount_amount_minor bigint,
  ADD CONSTRAINT document_template_positions_discount_amount_check CHECK (
    discount_amount_minor IS NULL OR discount_amount_minor >= 0
  );

-- DOC-PRODUCT-01.3: a position keeps whether its stored unit price is gross or
-- net. Rows written before this migration keep their old meaning: gross.
ALTER TABLE document_lines
  ADD COLUMN price_basis text NOT NULL DEFAULT 'gross',
  ADD CONSTRAINT document_lines_price_basis_check CHECK (
    price_basis IN ('gross', 'net')
  );

ALTER TABLE document_template_positions
  ADD COLUMN price_basis text NOT NULL DEFAULT 'gross',
  ADD CONSTRAINT document_template_positions_price_basis_check CHECK (
    price_basis IN ('gross', 'net')
  );

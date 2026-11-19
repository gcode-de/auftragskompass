ALTER TABLE document_lines
  ADD COLUMN is_information boolean NOT NULL DEFAULT false,
  DROP CONSTRAINT document_lines_description_check,
  ALTER COLUMN quantity DROP NOT NULL,
  ALTER COLUMN unit DROP NOT NULL,
  ALTER COLUMN unit_price_minor DROP NOT NULL,
  ALTER COLUMN tax_basis_points DROP NOT NULL,
  ALTER COLUMN discount_basis_points DROP NOT NULL,
  ADD CONSTRAINT document_lines_kind_values CHECK (
    (is_information
      AND length(trim(description)) BETWEEN 1 AND 4000
      AND description ~ '[^[:space:]]'
      AND product_id IS NULL
      AND quantity IS NULL AND unit IS NULL AND unit_price_minor IS NULL
      AND tax_basis_points IS NULL AND discount_basis_points IS NULL)
    OR
    (NOT is_information
      AND length(trim(description)) BETWEEN 1 AND 300
      AND quantity IS NOT NULL AND unit IS NOT NULL AND unit_price_minor IS NOT NULL
      AND tax_basis_points IS NOT NULL AND discount_basis_points IS NOT NULL)
  );

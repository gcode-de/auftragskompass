ALTER TABLE document_lines
  ADD COLUMN is_optional boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT document_lines_optional_service_check CHECK (
    NOT is_optional OR NOT is_information
  );

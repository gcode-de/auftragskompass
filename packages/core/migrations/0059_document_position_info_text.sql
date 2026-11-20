ALTER TABLE document_lines
  ADD COLUMN info_text text,
  ADD CONSTRAINT document_lines_info_text_check CHECK (
    info_text IS NULL OR (
      NOT is_information
      AND length(info_text) BETWEEN 1 AND 4000
      AND info_text ~ '[^[:space:]]'
    )
  );

-- An offer may be made without a validity period: 0 days means "ohne
-- Gültigkeit". The offer then prints no "Gültig bis" line, keeps
-- valid_until NULL and never expires. Widening a CHECK only; no data changes.
ALTER TABLE documents DROP CONSTRAINT documents_draft_content_lengths;
ALTER TABLE documents ADD CONSTRAINT documents_draft_content_lengths CHECK (
  (subject IS NULL AND intro_text IS NULL AND outro_text IS NULL AND validity_days IS NULL)
  OR
  (subject IS NOT NULL AND length(subject) <= 200
    AND intro_text IS NOT NULL AND length(intro_text) <= 4000
    AND outro_text IS NOT NULL AND length(outro_text) <= 4000
    AND validity_days IS NOT NULL AND validity_days BETWEEN 0 AND 365)
);
ALTER TABLE document_templates DROP CONSTRAINT document_templates_validity_days_check;
ALTER TABLE document_templates ADD CONSTRAINT document_templates_validity_days_check
  CHECK (validity_days BETWEEN 0 AND 365);

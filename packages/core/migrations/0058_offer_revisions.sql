ALTER TABLE documents ADD COLUMN predecessor_document_id uuid;
ALTER TABLE documents
  ADD CONSTRAINT documents_revision_offer_check CHECK (
    predecessor_document_id IS NULL
    OR (kind = 'offer' AND predecessor_document_id <> id)
  ),
  ADD CONSTRAINT documents_revision_predecessor_fk
    FOREIGN KEY (tenant_id, predecessor_document_id) REFERENCES documents (tenant_id, id);

CREATE UNIQUE INDEX documents_revision_predecessor_unique
  ON documents (tenant_id, predecessor_document_id)
  WHERE predecessor_document_id IS NOT NULL;

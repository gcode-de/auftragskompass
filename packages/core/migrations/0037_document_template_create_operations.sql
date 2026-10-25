CREATE TABLE document_template_create_operations (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  request_id uuid NOT NULL,
  template_id uuid NOT NULL,
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  response jsonb NOT NULL CHECK (jsonb_typeof(response) = 'object'),
  PRIMARY KEY (tenant_id, request_id),
  FOREIGN KEY (tenant_id, template_id)
    REFERENCES document_templates(tenant_id, id)
);

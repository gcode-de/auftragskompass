CREATE TABLE website_inquiry_ack_operations (
 tenant_id uuid NOT NULL REFERENCES tenants(id),id uuid NOT NULL,
 created_at timestamptz NOT NULL,completed_at timestamptz,
 PRIMARY KEY(tenant_id,id),CHECK(completed_at IS NULL OR completed_at>=created_at)
);
CREATE UNIQUE INDEX website_inquiry_ack_pending_idx ON website_inquiry_ack_operations(tenant_id) WHERE completed_at IS NULL;
CREATE TABLE website_inquiry_ack_items (
 tenant_id uuid NOT NULL,operation_id uuid NOT NULL,inquiry_id uuid NOT NULL,
 PRIMARY KEY(tenant_id,inquiry_id),
 FOREIGN KEY(tenant_id,operation_id) REFERENCES website_inquiry_ack_operations(tenant_id,id),
 FOREIGN KEY(tenant_id,inquiry_id) REFERENCES website_inquiry_deliveries(tenant_id,id)
);
CREATE INDEX website_inquiry_ack_items_operation_idx ON website_inquiry_ack_items(tenant_id,operation_id);
CREATE TABLE website_inquiry_ack_attempts (
 tenant_id uuid NOT NULL,message_id uuid NOT NULL,operation_id uuid NOT NULL,created_at timestamptz NOT NULL,
 PRIMARY KEY(tenant_id,message_id),
 FOREIGN KEY(tenant_id,operation_id) REFERENCES website_inquiry_ack_operations(tenant_id,id)
);

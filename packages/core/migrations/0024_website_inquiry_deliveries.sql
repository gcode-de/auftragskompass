CREATE TABLE website_inquiry_deliveries (
 tenant_id uuid NOT NULL REFERENCES tenants(id),id uuid NOT NULL,
 payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object' AND octet_length(payload::text)<=65536),
 payload_hash text NOT NULL CHECK(payload_hash ~ '^[0-9a-f]{64}$'),
 CHECK(payload_hash=encode(sha256(convert_to(payload::text,'UTF8')),'hex')),
 received_at timestamptz NOT NULL,expires_at timestamptz NOT NULL,
 staged_at timestamptz NOT NULL,staged_by uuid NOT NULL,
 PRIMARY KEY(tenant_id,id),
 FOREIGN KEY(tenant_id,staged_by) REFERENCES users(tenant_id,id),
 CHECK(expires_at>received_at AND expires_at<=received_at+interval '168 hours'),
 CHECK(staged_at<expires_at AND received_at<=staged_at+interval '30 seconds')
);
CREATE INDEX website_inquiry_deliveries_staged_idx ON website_inquiry_deliveries(tenant_id,staged_at,id);

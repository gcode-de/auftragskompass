CREATE TABLE website_inquiries (
 tenant_id uuid NOT NULL REFERENCES tenants(id),id uuid NOT NULL,
 contact_id uuid NOT NULL,event_id uuid NOT NULL,
 payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object' AND octet_length(payload::text)<=65536),
 payload_hash text NOT NULL CHECK(payload_hash ~ '^[0-9a-f]{64}$'),
 CHECK(payload_hash=encode(sha256(convert_to(payload::text,'UTF8')),'hex')),
 received_at timestamptz NOT NULL,expires_at timestamptz NOT NULL,
 imported_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(tenant_id,id),UNIQUE(tenant_id,event_id),
 FOREIGN KEY(tenant_id,contact_id) REFERENCES contacts(tenant_id,id),
 FOREIGN KEY(tenant_id,event_id) REFERENCES events(tenant_id,id),
 CHECK(expires_at>received_at AND expires_at<=received_at+interval '168 hours')
);
CREATE INDEX website_inquiries_received_idx ON website_inquiries(tenant_id,received_at,id);
ALTER TABLE event_activities ADD COLUMN source text CHECK(length(source)<=200);
ALTER TABLE event_activities DROP CONSTRAINT event_activities_kind_check;
ALTER TABLE event_activities ADD CONSTRAINT event_activities_kind_check
 CHECK(kind IN ('created','updated','status_changed','resources_changed','website_received'));
ALTER TABLE event_activities ADD CONSTRAINT event_activities_website_source_required
 CHECK(kind<>'website_received' OR (source IS NOT NULL AND length(source)>0));

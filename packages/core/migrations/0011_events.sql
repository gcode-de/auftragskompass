ALTER TABLE master_data ADD CONSTRAINT master_data_tenant_id_kind_unique UNIQUE(tenant_id,id,kind);
CREATE TABLE events (
 tenant_id uuid NOT NULL REFERENCES tenants(id),id uuid NOT NULL,
 name text NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 200),
 -- Confirmed bookings require the reservation model introduced by C021-C023.
 status text NOT NULL CHECK(status IN ('inquiry','option','unavailable','cancelled')),
 event_type_id uuid, package_id uuid,location_id uuid,
 event_type_kind text GENERATED ALWAYS AS ('event_type'::text) STORED,
 package_kind text GENERATED ALWAYS AS ('package'::text) STORED,
 source text NOT NULL CHECK(length(source)<=200),event_date date,starts_at timestamptz,ends_at timestamptz,
 time_zone text NOT NULL,description text NOT NULL CHECK(length(description)<=4000),notes_html text NOT NULL CHECK(length(notes_html)<=20000),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),PRIMARY KEY(tenant_id,id),
 FOREIGN KEY(tenant_id,event_type_id,event_type_kind) REFERENCES master_data(tenant_id,id,kind),
 FOREIGN KEY(tenant_id,package_id,package_kind) REFERENCES master_data(tenant_id,id,kind),
 FOREIGN KEY(tenant_id,location_id) REFERENCES locations(tenant_id,id),
 CHECK((starts_at IS NULL AND ends_at IS NULL) OR (event_date IS NOT NULL AND starts_at IS NOT NULL AND ends_at IS NOT NULL AND starts_at<ends_at)),
 CHECK(starts_at IS NULL OR (starts_at AT TIME ZONE time_zone)::date=event_date)
);
CREATE TABLE event_contacts (
 tenant_id uuid NOT NULL,event_id uuid NOT NULL,contact_id uuid NOT NULL,role text NOT NULL CHECK(role IN ('primary','additional')),
 PRIMARY KEY(tenant_id,event_id,contact_id),
 FOREIGN KEY(tenant_id,event_id) REFERENCES events(tenant_id,id),
 FOREIGN KEY(tenant_id,contact_id) REFERENCES contacts(tenant_id,id)
);
CREATE UNIQUE INDEX event_contacts_primary_idx ON event_contacts(tenant_id,event_id) WHERE role='primary';
CREATE INDEX event_contacts_contact_idx ON event_contacts(tenant_id,contact_id);
ALTER TABLE audit_events DROP CONSTRAINT audit_events_action_check;
ALTER TABLE audit_events ADD CONSTRAINT audit_events_action_check CHECK(action IN ('login.succeeded','login.denied','login.failed','logout','master_data.created','master_data.updated','resource.created','resource.updated','product.created','product.updated','contact.created','contact.updated','location.created','location.updated','event.created','event.updated'));

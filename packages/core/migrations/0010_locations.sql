CREATE TABLE locations (
 tenant_id uuid NOT NULL REFERENCES tenants(id),id uuid NOT NULL,
 name text NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 200),
 street text NOT NULL CHECK(length(street)<=200),postal_code text NOT NULL CHECK(length(postal_code)<=20),
 city text NOT NULL CHECK(length(city)<=120),country text NOT NULL CHECK(country ~ '^[A-Z]{2}$'),
 state text NOT NULL CHECK(state IN ('active','archived')),version integer NOT NULL DEFAULT 1 CHECK(version>0),PRIMARY KEY(tenant_id,id)
);
ALTER TABLE audit_events DROP CONSTRAINT audit_events_action_check;
ALTER TABLE audit_events ADD CONSTRAINT audit_events_action_check CHECK(action IN ('login.succeeded','login.denied','login.failed','logout','master_data.created','master_data.updated','resource.created','resource.updated','product.created','product.updated','contact.created','contact.updated','location.created','location.updated'));

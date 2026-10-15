CREATE TABLE contacts (
 tenant_id uuid NOT NULL REFERENCES tenants(id), id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('private','company')),
 name text NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 200),
 contact_person text NOT NULL CHECK(length(contact_person)<=200),
 street text NOT NULL CHECK(length(street)<=200), postal_code text NOT NULL CHECK(length(postal_code)<=20),
 city text NOT NULL CHECK(length(city)<=120),country text NOT NULL CHECK(country ~ '^[A-Z]{2}$'),
 email text NOT NULL CHECK(length(email)<=254 AND email=lower(trim(email))),
 phone text NOT NULL CHECK(length(phone)<=60 AND phone ~ '^[+0-9() ./-]*$'),
 mobile text NOT NULL CHECK(length(mobile)<=60 AND mobile ~ '^[+0-9() ./-]*$'),
 phone_key text NOT NULL CHECK(phone_key ~ '^[0-9]*$'), mobile_key text NOT NULL CHECK(mobile_key ~ '^[0-9]*$'),
 state text NOT NULL CHECK(state IN ('active','archived')),version integer NOT NULL DEFAULT 1 CHECK(version>0),
 PRIMARY KEY(tenant_id,id)
);
CREATE INDEX contacts_email_idx ON contacts(tenant_id,email);
CREATE INDEX contacts_phone_idx ON contacts(tenant_id,phone_key);
CREATE INDEX contacts_mobile_idx ON contacts(tenant_id,mobile_key);
ALTER TABLE audit_events DROP CONSTRAINT audit_events_action_check;
ALTER TABLE audit_events ADD CONSTRAINT audit_events_action_check CHECK(action IN ('login.succeeded','login.denied','login.failed','logout','master_data.created','master_data.updated','resource.created','resource.updated','product.created','product.updated','contact.created','contact.updated'));

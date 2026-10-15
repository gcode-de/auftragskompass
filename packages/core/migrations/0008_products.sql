CREATE TABLE products (
 tenant_id uuid NOT NULL REFERENCES tenants(id), id uuid NOT NULL,
 name text NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 120),
 description text NOT NULL CHECK(length(description)<=2000),
 unit text NOT NULL CHECK(length(trim(unit)) BETWEEN 1 AND 40),
 price_minor bigint NOT NULL CHECK(price_minor BETWEEN 0 AND 9007199254740991),
 price_basis text NOT NULL CHECK(price_basis IN ('net','gross')),
 tax_basis_points integer NOT NULL CHECK(tax_basis_points BETWEEN 0 AND 10000),
 state text NOT NULL CHECK(state IN ('active','inactive','archived')),
 position integer NOT NULL CHECK(position BETWEEN 0 AND 9999),
 version integer NOT NULL DEFAULT 1 CHECK(version>0), PRIMARY KEY(tenant_id,id)
);
ALTER TABLE audit_events DROP CONSTRAINT audit_events_action_check;
ALTER TABLE audit_events ADD CONSTRAINT audit_events_action_check CHECK(action IN ('login.succeeded','login.denied','login.failed','logout','master_data.created','master_data.updated','resource.created','resource.updated','product.created','product.updated'));

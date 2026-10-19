CREATE TABLE document_templates (
 tenant_id uuid NOT NULL REFERENCES tenants(id), id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('offer','order_confirmation','deposit_invoice','invoice','correction')),
 name text NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 120),
 subject text NOT NULL CHECK(length(subject)<=200),
 intro_text text NOT NULL CHECK(length(intro_text)<=4000),
 outro_text text NOT NULL CHECK(length(outro_text)<=4000),
 validity_days integer NOT NULL DEFAULT 14 CHECK(validity_days BETWEEN 1 AND 365),
 state text NOT NULL CHECK(state IN ('active','inactive','archived')),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 PRIMARY KEY(tenant_id,id)
);
CREATE TABLE document_template_positions (
 tenant_id uuid NOT NULL, template_id uuid NOT NULL, id uuid NOT NULL,
 position integer NOT NULL CHECK(position BETWEEN 0 AND 999),
 product_id uuid,
 description text NOT NULL CHECK(length(trim(description)) BETWEEN 1 AND 300),
 quantity integer NOT NULL CHECK(quantity BETWEEN 1 AND 100000),
 unit text NOT NULL CHECK(length(trim(unit)) BETWEEN 1 AND 40),
 unit_price_minor bigint NOT NULL CHECK(unit_price_minor BETWEEN 0 AND 9007199254740991),
 tax_basis_points integer NOT NULL CHECK(tax_basis_points BETWEEN 0 AND 10000),
 discount_basis_points integer NOT NULL DEFAULT 0 CHECK(discount_basis_points BETWEEN 0 AND 10000),
 PRIMARY KEY(tenant_id,id),
 FOREIGN KEY(tenant_id,template_id) REFERENCES document_templates(tenant_id,id) ON DELETE CASCADE,
 FOREIGN KEY(tenant_id,product_id) REFERENCES products(tenant_id,id)
);
CREATE INDEX document_template_positions_order ON document_template_positions(tenant_id,template_id,position);
CREATE UNIQUE INDEX document_template_positions_slot ON document_template_positions(tenant_id,template_id,position);
CREATE INDEX document_templates_kind ON document_templates(tenant_id,kind,state);
ALTER TABLE audit_events DROP CONSTRAINT audit_events_action_check;
ALTER TABLE audit_events ADD CONSTRAINT audit_events_action_check CHECK(action IN (
 'login.succeeded','login.denied','login.failed','logout','master_data.created','master_data.updated',
 'resource.created','resource.updated','product.created','product.updated','contact.created','contact.updated',
 'location.created','location.updated','event.created','event.updated','reservation.created','reservation.updated','reservation.expired',
 'import.created','import.updated','import.reviewed','password.changed','password.change_denied','password.reset',
 'feed.created','feed.rotated','feed.revoked',
 'document_template.created','document_template.updated'
));

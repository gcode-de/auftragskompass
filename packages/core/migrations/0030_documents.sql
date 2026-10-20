CREATE TABLE documents (
 tenant_id uuid NOT NULL REFERENCES tenants(id), id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('offer','order_confirmation','deposit_invoice','invoice','correction')),
 template_id uuid NOT NULL, event_id uuid, contact_id uuid,
 -- Drafts carry no number; the unique index only bites once a number exists,
 -- because PostgreSQL treats NULLs as distinct.
 number text CHECK(number IS NULL OR length(trim(number)) BETWEEN 1 AND 60),
 state text NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','final','withdrawn')),
 -- issued_at is the date printed on the document: the creation instant while
 -- it is a draft, the issuing instant once it is final.
 issued_at timestamptz NOT NULL,
 finalized_at timestamptz,
 snapshot_hash text CHECK(snapshot_hash IS NULL OR snapshot_hash ~ '^[a-f0-9]{64}$'),
 pdf_hash text CHECK(pdf_hash IS NULL OR pdf_hash ~ '^[a-f0-9]{64}$'),
 net_minor bigint NOT NULL DEFAULT 0 CHECK(net_minor BETWEEN 0 AND 9007199254740991),
 tax_minor bigint NOT NULL DEFAULT 0 CHECK(tax_minor BETWEEN 0 AND 9007199254740991),
 gross_minor bigint NOT NULL DEFAULT 0 CHECK(gross_minor BETWEEN 0 AND 9007199254740991),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 PRIMARY KEY(tenant_id,id),
 UNIQUE(tenant_id,number),
 FOREIGN KEY(tenant_id,template_id) REFERENCES document_templates(tenant_id,id),
 FOREIGN KEY(tenant_id,event_id) REFERENCES events(tenant_id,id),
 FOREIGN KEY(tenant_id,contact_id) REFERENCES contacts(tenant_id,id),
 CHECK(net_minor + tax_minor = gross_minor),
 -- A final document must be complete; a draft must not pretend to be one.
 CHECK(state<>'final' OR (number IS NOT NULL AND finalized_at IS NOT NULL AND snapshot_hash IS NOT NULL AND pdf_hash IS NOT NULL)),
 CHECK(state<>'draft' OR (number IS NULL AND finalized_at IS NULL AND snapshot_hash IS NULL AND pdf_hash IS NULL))
);
CREATE INDEX documents_state ON documents(tenant_id,state,kind);
CREATE TABLE document_lines (
 tenant_id uuid NOT NULL, document_id uuid NOT NULL, id uuid NOT NULL,
 position integer NOT NULL CHECK(position BETWEEN 0 AND 999),
 product_id uuid,
 description text NOT NULL CHECK(length(trim(description)) BETWEEN 1 AND 300),
 quantity integer NOT NULL CHECK(quantity BETWEEN 1 AND 100000),
 unit text NOT NULL CHECK(length(trim(unit)) BETWEEN 1 AND 40),
 unit_price_minor bigint NOT NULL CHECK(unit_price_minor BETWEEN 0 AND 9007199254740991),
 tax_basis_points integer NOT NULL CHECK(tax_basis_points BETWEEN 0 AND 10000),
 discount_basis_points integer NOT NULL DEFAULT 0 CHECK(discount_basis_points BETWEEN 0 AND 10000),
 PRIMARY KEY(tenant_id,id),
 FOREIGN KEY(tenant_id,document_id) REFERENCES documents(tenant_id,id) ON DELETE CASCADE,
 FOREIGN KEY(tenant_id,product_id) REFERENCES products(tenant_id,id)
);
CREATE UNIQUE INDEX document_lines_slot ON document_lines(tenant_id,document_id,position);
ALTER TABLE audit_events DROP CONSTRAINT audit_events_action_check;
ALTER TABLE audit_events ADD CONSTRAINT audit_events_action_check CHECK(action IN (
 'login.succeeded','login.denied','login.failed','logout','master_data.created','master_data.updated',
 'resource.created','resource.updated','product.created','product.updated','contact.created','contact.updated',
 'location.created','location.updated','event.created','event.updated','reservation.created','reservation.updated','reservation.expired',
 'import.created','import.updated','import.reviewed','password.changed','password.change_denied','password.reset',
 'feed.created','feed.rotated','feed.revoked',
 'document_template.created','document_template.updated',
 'document_number.updated',
 'document_layout.updated',
 'document.created','document.finalized'
));

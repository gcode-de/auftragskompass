CREATE TABLE document_number_sequences (
 tenant_id uuid NOT NULL REFERENCES tenants(id),
 kind text NOT NULL CHECK(kind IN ('offer','order_confirmation','deposit_invoice','invoice','correction')),
 pattern text NOT NULL CHECK(length(trim(pattern)) BETWEEN 1 AND 60),
 min_length integer NOT NULL DEFAULT 4 CHECK(min_length BETWEEN 1 AND 12),
 next_value integer NOT NULL DEFAULT 1 CHECK(next_value BETWEEN 1 AND 2147483647),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 PRIMARY KEY(tenant_id,kind)
);
ALTER TABLE audit_events DROP CONSTRAINT audit_events_action_check;
ALTER TABLE audit_events ADD CONSTRAINT audit_events_action_check CHECK(action IN (
 'login.succeeded','login.denied','login.failed','logout','master_data.created','master_data.updated',
 'resource.created','resource.updated','product.created','product.updated','contact.created','contact.updated',
 'location.created','location.updated','event.created','event.updated','reservation.created','reservation.updated','reservation.expired',
 'import.created','import.updated','import.reviewed','password.changed','password.change_denied','password.reset',
 'feed.created','feed.rotated','feed.revoked',
 'document_template.created','document_template.updated',
 'document_number.updated'
));

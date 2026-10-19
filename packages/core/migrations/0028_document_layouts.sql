CREATE TABLE document_layouts (
 tenant_id uuid PRIMARY KEY REFERENCES tenants(id),
 sender_name text NOT NULL CHECK(length(trim(sender_name)) BETWEEN 1 AND 120),
 sender_street text NOT NULL CHECK(length(sender_street)<=120),
 sender_postal_code text NOT NULL CHECK(length(sender_postal_code)<=20),
 sender_city text NOT NULL CHECK(length(sender_city)<=80),
 primary_color text NOT NULL CHECK(primary_color ~ '^#[0-9a-f]{6}$'),
 text_color text NOT NULL CHECK(text_color ~ '^#[0-9a-f]{6}$'),
 font_family text NOT NULL CHECK(font_family IN ('system','sans','serif')),
 show_page_numbers boolean NOT NULL DEFAULT true,
 show_position_numbers boolean NOT NULL DEFAULT true,
 version integer NOT NULL DEFAULT 1 CHECK(version>0)
);
ALTER TABLE audit_events DROP CONSTRAINT audit_events_action_check;
ALTER TABLE audit_events ADD CONSTRAINT audit_events_action_check CHECK(action IN (
 'login.succeeded','login.denied','login.failed','logout','master_data.created','master_data.updated',
 'resource.created','resource.updated','product.created','product.updated','contact.created','contact.updated',
 'location.created','location.updated','event.created','event.updated','reservation.created','reservation.updated','reservation.expired',
 'import.created','import.updated','import.reviewed','password.changed','password.change_denied','password.reset',
 'feed.created','feed.rotated','feed.revoked',
 'document_template.created','document_template.updated',
 'document_number.updated',
 'document_layout.updated'
));

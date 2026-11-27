-- RES-BKP-01: Bookitup manages resource categories in the settings, may nest
-- them ("Innerhalb Kategorie") and creates a missing one when a resource is
-- saved with it. A resource keeps its category as text (all readers stay
-- unchanged); the category list is the managed set of those names, kept in
-- step by a trigger so seeds and imports never miss one. Names are unique per
-- tenant, so a name always means one category. The navigation switch hides the
-- resources entry only; the page and its settings stay reachable.
CREATE TABLE resource_categories (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120 AND name = trim(name)),
  parent_id uuid,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, parent_id)
    REFERENCES resource_categories(tenant_id, id) ON DELETE RESTRICT,
  CHECK (parent_id IS NULL OR parent_id <> id)
);
CREATE UNIQUE INDEX resource_category_name
  ON resource_categories (tenant_id, lower(name));

CREATE FUNCTION resource_category_from_resource() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO resource_categories (tenant_id, name)
  VALUES (NEW.tenant_id, trim(NEW.category))
  ON CONFLICT (tenant_id, lower(name)) DO NOTHING;
  RETURN NEW;
END $$;
CREATE TRIGGER resources_category_known
  AFTER INSERT OR UPDATE OF category ON resources
  FOR EACH ROW EXECUTE FUNCTION resource_category_from_resource();

INSERT INTO resource_categories (tenant_id, name)
SELECT DISTINCT ON (tenant_id, lower(trim(category))) tenant_id, trim(category)
FROM resources
ORDER BY tenant_id, lower(trim(category)), trim(category);

CREATE TABLE resource_settings (
  tenant_id uuid PRIMARY KEY REFERENCES tenants(id),
  hide_navigation boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE audit_events DROP CONSTRAINT audit_events_action_check;
ALTER TABLE audit_events ADD CONSTRAINT audit_events_action_check CHECK(action IN (
 'login.succeeded','login.denied','login.failed','logout','master_data.created','master_data.updated',
 'resource.created','resource.updated','product.created','product.updated','product.deleted','contact.created','contact.updated',
 'location.created','location.updated','event.created','event.updated','reservation.created','reservation.updated','reservation.expired',
 'import.created','import.updated','import.reviewed','password.changed','password.change_denied','password.reset',
 'feed.created','feed.rotated','feed.revoked',
 'document_template.created','document_template.updated',
 'document_number.updated','document_layout.updated',
 'document.created','document.updated','document.finalized',
 'document.sent','document.accepted','document.withdrawn','document.acceptance_corrected',
 'file.uploaded','file.archived','payment.recorded','file.event_linked','file.event_unlinked',
 'event.removed','event.restored',
 'mail.message_created','mail.send_scheduled',
 'mail.sent','mail.send_retry',
 'mail.document_send_scheduled','mail.account_saved',
 'mail.template_saved','mail.signature_saved',
 'event_note.created','event_note.removed',
 'mail.send_cancelled',
 'event_note.updated',
 'resource_category.created','resource_category.updated','resource_category.deleted',
 'resource_settings.updated'
));

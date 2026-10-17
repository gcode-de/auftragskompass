CREATE TABLE calendar_feeds (
 tenant_id uuid NOT NULL REFERENCES tenants(id),
 id uuid NOT NULL,
 owner_id uuid NOT NULL,
 token_hash text NOT NULL CHECK(token_hash ~ '^[a-f0-9]{64}$'),
 resource_id uuid,
 description boolean NOT NULL DEFAULT false,
 event_type boolean NOT NULL DEFAULT false,
 internal_link boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL DEFAULT now()+interval '1 year',
 PRIMARY KEY(tenant_id,id),
 UNIQUE(token_hash),
 FOREIGN KEY(tenant_id,owner_id) REFERENCES users(tenant_id,id),
 FOREIGN KEY(tenant_id,resource_id) REFERENCES resources(tenant_id,id),
 CHECK(expires_at > created_at)
);
CREATE TABLE calendar_revisions (
 tenant_id uuid PRIMARY KEY REFERENCES tenants(id),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 changed_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO calendar_revisions(tenant_id) SELECT id FROM tenants;
-- A shared monotonic sequence also covers renamed locations/resources and released reservations.
CREATE FUNCTION bump_calendar_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO calendar_revisions(tenant_id) VALUES(COALESCE(NEW.tenant_id,OLD.tenant_id))
 ON CONFLICT(tenant_id) DO UPDATE SET revision=calendar_revisions.revision+1,changed_at=clock_timestamp();
 RETURN NULL;
END;
$$;
CREATE TRIGGER calendar_events AFTER INSERT OR UPDATE OR DELETE ON events FOR EACH ROW EXECUTE FUNCTION bump_calendar_revision();
CREATE TRIGGER calendar_locations AFTER INSERT OR UPDATE OR DELETE ON locations FOR EACH ROW EXECUTE FUNCTION bump_calendar_revision();
CREATE TRIGGER calendar_units AFTER INSERT OR UPDATE OR DELETE ON resource_units FOR EACH ROW EXECUTE FUNCTION bump_calendar_revision();
CREATE TRIGGER calendar_resources AFTER INSERT OR UPDATE OR DELETE ON resources FOR EACH ROW EXECUTE FUNCTION bump_calendar_revision();
CREATE TRIGGER calendar_reservations AFTER INSERT OR UPDATE OR DELETE ON reservations FOR EACH ROW EXECUTE FUNCTION bump_calendar_revision();
CREATE TRIGGER calendar_feed_options AFTER INSERT OR UPDATE OR DELETE ON calendar_feeds FOR EACH ROW EXECUTE FUNCTION bump_calendar_revision();
CREATE TRIGGER calendar_master_data AFTER INSERT OR UPDATE OR DELETE ON master_data FOR EACH ROW EXECUTE FUNCTION bump_calendar_revision();
ALTER TABLE audit_events DROP CONSTRAINT audit_events_action_check;
ALTER TABLE audit_events ADD CONSTRAINT audit_events_action_check CHECK(action IN (
 'login.succeeded','login.denied','login.failed','logout','master_data.created','master_data.updated',
 'resource.created','resource.updated','product.created','product.updated','contact.created','contact.updated',
 'location.created','location.updated','event.created','event.updated','reservation.created','reservation.updated','reservation.expired',
 'import.created','import.updated','import.reviewed','password.changed','password.change_denied','password.reset',
 'feed.created','feed.rotated','feed.revoked'
));

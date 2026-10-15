CREATE TABLE resource_units (
 tenant_id uuid NOT NULL,id uuid NOT NULL DEFAULT gen_random_uuid(),resource_id uuid NOT NULL,
 ordinal integer NOT NULL CHECK(ordinal BETWEEN 1 AND 10000),enabled boolean NOT NULL,
 PRIMARY KEY(tenant_id,id),UNIQUE(tenant_id,resource_id,ordinal),
 FOREIGN KEY(tenant_id,resource_id) REFERENCES resources(tenant_id,id)
);
INSERT INTO resource_units(tenant_id,resource_id,ordinal,enabled)
 SELECT tenant_id,id,n,state='active' FROM resources CROSS JOIN LATERAL generate_series(1,quantity) n;
CREATE TABLE reservations (
 tenant_id uuid NOT NULL,id uuid NOT NULL,request_id uuid NOT NULL,request_hash text NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),
 event_id uuid,unit_id uuid NOT NULL,
 state text NOT NULL CHECK(state IN ('hold','booked','blocked','released','expired')),
 period_source text NOT NULL CHECK(period_source IN ('event','manual')),
 base_start timestamptz NOT NULL,base_end timestamptz NOT NULL,time_zone text NOT NULL,
 before_days integer NOT NULL CHECK(before_days BETWEEN 0 AND 365),after_days integer NOT NULL CHECK(after_days BETWEEN 0 AND 365),
 starts_at timestamptz NOT NULL,ends_at timestamptz NOT NULL,expires_at timestamptz,
 PRIMARY KEY(tenant_id,id),UNIQUE(tenant_id,request_id),
 FOREIGN KEY(tenant_id,event_id) REFERENCES events(tenant_id,id),
 FOREIGN KEY(tenant_id,unit_id) REFERENCES resource_units(tenant_id,id),
 CHECK(base_start<base_end AND starts_at<=base_start AND ends_at>=base_end AND starts_at<ends_at),
 CHECK(event_id IS NOT NULL OR state IN ('blocked','released')),
 CHECK(period_source='manual' OR event_id IS NOT NULL),
 CHECK(state NOT IN ('booked','blocked') OR expires_at IS NULL)
);
CREATE UNIQUE INDEX reservations_event_unit_live_idx ON reservations(tenant_id,event_id,unit_id) WHERE state IN ('hold','booked');
CREATE INDEX reservations_expiry_idx ON reservations(expires_at,tenant_id) WHERE state='hold' AND expires_at IS NOT NULL;
CREATE FUNCTION reservation_is_active(value text,expires timestamptz,as_of timestamptz) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
 SELECT value IN ('booked','blocked') OR (value='hold' AND (expires IS NULL OR expires>as_of));
$$;
CREATE FUNCTION sync_resource_units() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.tenant_id::text,814022));
 IF EXISTS(SELECT 1 FROM resource_units u JOIN reservations r ON r.tenant_id=u.tenant_id AND r.unit_id=u.id
   WHERE u.tenant_id=NEW.tenant_id AND u.resource_id=NEW.id AND (u.ordinal>NEW.quantity OR NEW.state<>'active')
   AND r.ends_at>clock_timestamp() AND reservation_is_active(r.state,r.expires_at,clock_timestamp())) THEN
   RAISE EXCEPTION 'resource_in_use' USING ERRCODE='23514',CONSTRAINT='resource_units_in_use';
 END IF;
 INSERT INTO resource_units(tenant_id,resource_id,ordinal,enabled)
 SELECT NEW.tenant_id,NEW.id,n,NEW.state='active' FROM generate_series(1,NEW.quantity) n ON CONFLICT(tenant_id,resource_id,ordinal) DO NOTHING;
 UPDATE resource_units SET enabled=(ordinal<=NEW.quantity AND NEW.state='active') WHERE tenant_id=NEW.tenant_id AND resource_id=NEW.id;
 RETURN NEW;
END;
$$;
CREATE TRIGGER resources_sync_units AFTER INSERT OR UPDATE OF quantity,state,blocked ON resources FOR EACH ROW EXECUTE FUNCTION sync_resource_units();
CREATE FUNCTION protect_reservation_unit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.tenant_id::text,814022));
 IF NEW.ends_at>clock_timestamp() AND reservation_is_active(NEW.state,NEW.expires_at,clock_timestamp()) AND NOT EXISTS(
  SELECT 1 FROM resource_units u JOIN resources r ON r.tenant_id=u.tenant_id AND r.id=u.resource_id
  WHERE u.tenant_id=NEW.tenant_id AND u.id=NEW.unit_id AND u.enabled AND r.state='active' AND (NOT r.blocked OR NEW.state='blocked')
 ) THEN RAISE EXCEPTION 'unit_unavailable' USING ERRCODE='23514',CONSTRAINT='reservation_unit_unavailable'; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER reservation_unit_available BEFORE INSERT OR UPDATE ON reservations FOR EACH ROW EXECUTE FUNCTION protect_reservation_unit();
ALTER TABLE audit_events DROP CONSTRAINT audit_events_action_check;
ALTER TABLE audit_events ADD CONSTRAINT audit_events_action_check CHECK(action IN ('login.succeeded','login.denied','login.failed','logout','master_data.created','master_data.updated','resource.created','resource.updated','product.created','product.updated','contact.created','contact.updated','location.created','location.updated','event.created','event.updated','reservation.created','reservation.updated','reservation.expired'));

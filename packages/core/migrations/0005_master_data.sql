CREATE TABLE master_data (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('event_type','package')),
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  position integer NOT NULL CHECK (position BETWEEN 0 AND 9999),
  state text NOT NULL CHECK (state IN ('active','inactive','archived')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  PRIMARY KEY (tenant_id,id),
  UNIQUE (tenant_id,id,kind)
);
CREATE UNIQUE INDEX master_data_unique_name ON master_data(tenant_id,kind,lower(trim(name)));
ALTER TABLE audit_events DROP CONSTRAINT audit_events_action_check;
ALTER TABLE audit_events ADD COLUMN record_id uuid;
ALTER TABLE audit_events ADD CONSTRAINT audit_events_action_check CHECK (action IN ('login.succeeded','login.denied','login.failed','logout','master_data.created','master_data.updated'));
CREATE FUNCTION seed_event_types(p_tenant uuid) RETURNS void LANGUAGE sql AS $$
  WITH created AS (
    INSERT INTO master_data(tenant_id,id,kind,name,position,state)
    SELECT p_tenant,gen_random_uuid(),'event_type',v.name,v.position,'active'
    FROM (VALUES ('Hochzeit',0),('Geburtstag',1),('Firmenfeier',2),('Weihnachtsfeier',3),('sonstiges',4)) v(name,position)
    RETURNING tenant_id,id
  ) INSERT INTO audit_events(tenant_id,action,record_id) SELECT tenant_id,'master_data.created',id FROM created;
$$;
SELECT seed_event_types(id) FROM tenants;
CREATE FUNCTION seed_new_tenant_master_data() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM seed_event_types(NEW.id);
  RETURN NEW;
END;
$$;
CREATE TRIGGER tenant_master_data AFTER INSERT ON tenants FOR EACH ROW EXECUTE FUNCTION seed_new_tenant_master_data();

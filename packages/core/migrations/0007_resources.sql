CREATE TABLE resources (
 tenant_id uuid NOT NULL REFERENCES tenants(id), id uuid NOT NULL,
 name text NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 120),
 code text NOT NULL CHECK(length(trim(code)) BETWEEN 1 AND 40),
 category text NOT NULL CHECK(length(trim(category)) BETWEEN 1 AND 120),
 description text NOT NULL DEFAULT '' CHECK(length(description)<=2000),
 quantity integer NOT NULL CHECK(quantity BETWEEN 0 AND 10000),
 before_days integer NOT NULL CHECK(before_days BETWEEN 0 AND 365),
 after_days integer NOT NULL CHECK(after_days BETWEEN 0 AND 365),
 blocked boolean NOT NULL DEFAULT false,
 state text NOT NULL CHECK(state IN ('active','inactive','archived')),
 position integer NOT NULL CHECK(position BETWEEN 0 AND 9999),
 version integer NOT NULL DEFAULT 1 CHECK(version>0), PRIMARY KEY(tenant_id,id)
);
CREATE UNIQUE INDEX resource_code ON resources(tenant_id,lower(trim(code)));
ALTER TABLE audit_events DROP CONSTRAINT audit_events_action_check;
ALTER TABLE audit_events ADD CONSTRAINT audit_events_action_check CHECK(action IN ('login.succeeded','login.denied','login.failed','logout','master_data.created','master_data.updated','resource.created','resource.updated'));
CREATE FUNCTION seed_resources(p_tenant uuid) RETURNS void LANGUAGE sql AS $$
 WITH created AS (
 INSERT INTO resources(tenant_id,id,name,code,category,quantity,before_days,after_days,state,position)
 SELECT p_tenant,gen_random_uuid(),v.name,v.code,v.category,1,v.buffer,v.buffer,'active',v.position
 FROM (VALUES ('FB1','FB1','Fotobox',2,0),('FB2','FB2','Fotobox',2,1),('Glamour-Paket','GLAMOUR','Zubehör',0,2),('Schwarzwald-Paket','SCHWARZWALD','Zubehör',0,3)) v(name,code,category,buffer,position)
 RETURNING tenant_id,id
 ) INSERT INTO audit_events(tenant_id,record_id,action) SELECT tenant_id,id,'resource.created' FROM created;
$$;
SELECT seed_resources(id) FROM tenants;
CREATE FUNCTION seed_new_tenant_resources() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN PERFORM seed_resources(NEW.id); RETURN NEW; END;
$$;
CREATE TRIGGER tenant_resources AFTER INSERT ON tenants FOR EACH ROW EXECUTE FUNCTION seed_new_tenant_resources();

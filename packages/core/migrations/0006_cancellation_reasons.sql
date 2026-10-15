ALTER TABLE master_data DROP CONSTRAINT master_data_kind_check;
ALTER TABLE master_data ADD CONSTRAINT master_data_kind_check CHECK (kind IN ('event_type','package','cancellation_reason'));
CREATE FUNCTION seed_cancellation_reasons(p_tenant uuid) RETURNS void LANGUAGE sql AS $$
  WITH created AS (
    INSERT INTO master_data(tenant_id,id,kind,name,position,state)
    SELECT p_tenant,gen_random_uuid(),'cancellation_reason',v.name,v.position,'active'
    FROM (VALUES ('Termin belegt',0),('Zubehör nicht verfügbar',1),('Preis',2),('keine Rückmeldung',3),('anderer Anbieter',4),('Kunde abgesagt',5),('Termin verschoben',6),('Sonstiges',7)) v(name,position)
    RETURNING tenant_id,id
  ) INSERT INTO audit_events(tenant_id,action,record_id) SELECT tenant_id,'master_data.created',id FROM created;
$$;
SELECT seed_cancellation_reasons(id) FROM tenants;
CREATE FUNCTION seed_new_tenant_cancellation_reasons() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM seed_cancellation_reasons(NEW.id);
  RETURN NEW;
END;
$$;
CREATE TRIGGER tenant_cancellation_reasons AFTER INSERT ON tenants FOR EACH ROW EXECUTE FUNCTION seed_new_tenant_cancellation_reasons();

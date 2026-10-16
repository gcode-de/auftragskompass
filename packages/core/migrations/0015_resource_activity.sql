ALTER TABLE event_activities DROP CONSTRAINT event_activities_kind_check;
ALTER TABLE event_activities ADD CONSTRAINT event_activities_kind_check
 CHECK(kind IN ('created','updated','status_changed','resources_changed'));

ALTER TABLE events DROP CONSTRAINT events_status_check;
ALTER TABLE events ADD CONSTRAINT events_status_check
 CHECK(status IN ('inquiry','option','booked','unavailable','cancelled'));
-- Deferred checks allow replacement of all assignments in one transaction.
-- Checking the final tenant state also covers category changes and removed units.
CREATE FUNCTION check_booked_event_box() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_tenant uuid := COALESCE(NEW.tenant_id,OLD.tenant_id);
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(target_tenant::text,814022));
 IF EXISTS(
  SELECT 1 FROM events e WHERE e.tenant_id=target_tenant AND e.status='booked' AND NOT EXISTS(
   SELECT 1 FROM reservations r JOIN resource_units u ON u.tenant_id=r.tenant_id AND u.id=r.unit_id
    JOIN resources s ON s.tenant_id=u.tenant_id AND s.id=u.resource_id
   WHERE r.tenant_id=e.tenant_id AND r.event_id=e.id AND r.state='booked' AND lower(trim(s.category))='fotobox'
  )
 ) THEN RAISE EXCEPTION 'booking_required' USING ERRCODE='23514',CONSTRAINT='booked_event_requires_box'; END IF;
 RETURN NEW;
END;
$$;
CREATE CONSTRAINT TRIGGER events_booked_box AFTER INSERT OR UPDATE OR DELETE ON events
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_booked_event_box();
CREATE CONSTRAINT TRIGGER reservations_booked_box AFTER INSERT OR UPDATE OR DELETE ON reservations
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_booked_event_box();
CREATE CONSTRAINT TRIGGER resources_booked_box AFTER INSERT OR UPDATE OR DELETE ON resources
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_booked_event_box();
CREATE CONSTRAINT TRIGGER units_booked_box AFTER INSERT OR UPDATE OR DELETE ON resource_units
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_booked_event_box();

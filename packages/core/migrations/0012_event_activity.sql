CREATE TABLE event_activities (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 tenant_id uuid NOT NULL,event_id uuid NOT NULL,actor_id uuid,
 event_version integer CHECK(event_version>0),
 kind text NOT NULL CHECK(kind IN ('created','updated','status_changed')),
 previous_status text CHECK(previous_status IN ('inquiry','option','booked','unavailable','cancelled')),
 next_status text CHECK(next_status IN ('inquiry','option','booked','unavailable','cancelled')),
 occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(tenant_id,event_id) REFERENCES events(tenant_id,id),
 FOREIGN KEY(tenant_id,actor_id) REFERENCES users(tenant_id,id),
 CHECK(kind<>'status_changed' OR (previous_status IS NOT NULL AND next_status IS NOT NULL AND previous_status<>next_status))
);
CREATE INDEX event_activities_event_idx ON event_activities(tenant_id,event_id,occurred_at,id);
-- Earlier audit rows did not retain versions or status values; leave those unknown.
INSERT INTO event_activities(tenant_id,event_id,actor_id,kind,occurred_at)
 SELECT a.tenant_id,a.record_id,a.actor_id,CASE a.action WHEN 'event.created' THEN 'created' ELSE 'updated' END,a.occurred_at
 FROM audit_events a JOIN events e ON e.tenant_id=a.tenant_id AND e.id=a.record_id
 WHERE a.action IN ('event.created','event.updated') ORDER BY a.id;
CREATE TRIGGER event_activities_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON event_activities
 FOR EACH STATEMENT EXECUTE FUNCTION reject_access_audit_mutation();

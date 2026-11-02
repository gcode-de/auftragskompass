-- Booked events do not require a resource assignment. Existing reservation
-- overlap constraints remain authoritative whenever an assignment exists.
DROP TRIGGER events_booked_box ON events;
DROP TRIGGER reservations_booked_box ON reservations;
DROP TRIGGER resources_booked_box ON resources;
DROP TRIGGER units_booked_box ON resource_units;
DROP FUNCTION check_booked_event_box();

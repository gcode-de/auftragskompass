-- H034: the booking carries an optional free-form place/address. Legacy
-- locations stay untouched: venue_override decides which source is effective.
ALTER TABLE events ADD COLUMN venue text CHECK(venue IS NULL OR length(venue)<=1000);
ALTER TABLE events ADD COLUMN venue_override boolean NOT NULL DEFAULT false;

-- Unreviewed source promises remain separate from confirmed operational events.
CREATE TABLE import_promises (
 tenant_id uuid NOT NULL REFERENCES tenants(id), id uuid NOT NULL,
 data jsonb NOT NULL CHECK(jsonb_typeof(data)='object' AND (data->>'status') IS NOT DISTINCT FROM 'booked'),
 time_zone text NOT NULL, version integer NOT NULL DEFAULT 1 CHECK(version>0),
 PRIMARY KEY(tenant_id,id)
);
CREATE TABLE import_records (
 tenant_id uuid NOT NULL REFERENCES tenants(id),
 source text NOT NULL DEFAULT 'bookitup' CHECK(source='bookitup'),
 section text NOT NULL CHECK(section IN ('contacts','locations','eventTypes','packages','events')),
 external_id text NOT NULL CHECK(length(external_id) BETWEEN 1 AND 200 AND external_id=trim(external_id)),
 content_hash text NOT NULL CHECK(content_hash ~ '^[0-9a-f]{64}$'),
 target_version integer NOT NULL CHECK(target_version>0),
 source_status text NOT NULL DEFAULT '',
 contact_id uuid, location_id uuid, master_id uuid, event_id uuid, promise_id uuid,
 master_kind text GENERATED ALWAYS AS (CASE section WHEN 'eventTypes' THEN 'event_type' WHEN 'packages' THEN 'package' END) STORED,
 PRIMARY KEY(tenant_id,source,section,external_id),
 UNIQUE(tenant_id,contact_id), UNIQUE(tenant_id,location_id), UNIQUE(tenant_id,master_id),
 UNIQUE(tenant_id,event_id), UNIQUE(tenant_id,promise_id),
 FOREIGN KEY(tenant_id,contact_id) REFERENCES contacts(tenant_id,id),
 FOREIGN KEY(tenant_id,location_id) REFERENCES locations(tenant_id,id),
 FOREIGN KEY(tenant_id,master_id,master_kind) REFERENCES master_data(tenant_id,id,kind),
 FOREIGN KEY(tenant_id,event_id) REFERENCES events(tenant_id,id),
 FOREIGN KEY(tenant_id,promise_id) REFERENCES import_promises(tenant_id,id),
 CHECK(num_nonnulls(contact_id,location_id,master_id,event_id,promise_id)=1),
 CHECK((section='contacts' AND contact_id IS NOT NULL AND source_status='') OR
       (section='locations' AND location_id IS NOT NULL AND source_status='') OR
       (section IN ('eventTypes','packages') AND master_id IS NOT NULL AND source_status='') OR
       (section='events' AND (event_id IS NOT NULL OR promise_id IS NOT NULL) AND source_status IN ('Anfrage','Option','Gebucht','Nicht verfügbar','Annulliert'))),
 CHECK(promise_id IS NULL OR source_status='Gebucht')
);
ALTER TABLE audit_events DROP CONSTRAINT audit_events_action_check;
ALTER TABLE audit_events ADD CONSTRAINT audit_events_action_check CHECK(action IN (
 'login.succeeded','login.denied','login.failed','logout','master_data.created','master_data.updated',
 'resource.created','resource.updated','product.created','product.updated','contact.created','contact.updated',
 'location.created','location.updated','event.created','event.updated','reservation.created','reservation.updated','reservation.expired',
 'import.created','import.updated'
));

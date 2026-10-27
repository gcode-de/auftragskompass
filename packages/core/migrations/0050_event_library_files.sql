CREATE TABLE event_library_files (
 tenant_id uuid NOT NULL,
 event_id uuid NOT NULL,
 file_id uuid NOT NULL,
 linked_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (tenant_id,event_id,file_id),
 FOREIGN KEY (tenant_id,event_id) REFERENCES events(tenant_id,id),
 FOREIGN KEY (tenant_id,file_id) REFERENCES library_files(tenant_id,id)
);
ALTER TABLE audit_events ADD COLUMN related_record_id uuid;
ALTER TABLE audit_events DROP CONSTRAINT audit_events_action_check;
ALTER TABLE audit_events ADD CONSTRAINT audit_events_action_check CHECK(action IN (
 'login.succeeded','login.denied','login.failed','logout','master_data.created','master_data.updated',
 'resource.created','resource.updated','product.created','product.updated','contact.created','contact.updated',
 'location.created','location.updated','event.created','event.updated','reservation.created','reservation.updated','reservation.expired',
 'import.created','import.updated','import.reviewed','password.changed','password.change_denied','password.reset',
 'feed.created','feed.rotated','feed.revoked',
 'document_template.created','document_template.updated',
 'document_number.updated','document_layout.updated',
 'document.created','document.updated','document.finalized',
 'document.sent','document.accepted','document.withdrawn',
 'file.uploaded','file.archived',
 'payment.recorded','file.event_linked','file.event_unlinked'
));

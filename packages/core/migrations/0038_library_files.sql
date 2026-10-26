-- BKP020.1: tenant-bound library files. The bytes live in the storage adapter;
-- this table only keeps metadata. display_name is plain data and never becomes
-- a storage key or a path: keys are generated from a UUID plus the derived
-- extension (packages/core/src/library-files.ts).
CREATE TABLE library_files (
 tenant_id uuid NOT NULL REFERENCES tenants(id), id uuid NOT NULL,
 display_name text NOT NULL CHECK(length(display_name) BETWEEN 1 AND 200 AND display_name = btrim(display_name)),
 media_type text NOT NULL CHECK(media_type IN ('application/pdf','image/png','image/jpeg','application/zip')),
 size_bytes bigint NOT NULL CHECK(size_bytes BETWEEN 1 AND 10485760),
 sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
 -- Same shape the storage adapter accepts: a plain file name, no separators.
 storage_key text NOT NULL CHECK(storage_key ~ '^[a-z0-9][a-z0-9._-]{0,127}$' AND position('..' in storage_key) = 0),
 -- This slice ships no malware scanner. not_scanned is the only value until a
 -- scanner exists; mail attachments must stay blocked on any other value.
 scan_state text NOT NULL DEFAULT 'not_scanned' CHECK(scan_state IN ('not_scanned')),
 -- rejected stays in the enum for later, but this slice does not persist
 -- rejected uploads: they stay an HTTP result plus an audit entry.
 state text NOT NULL DEFAULT 'available' CHECK(state IN ('available','archived','rejected')),
 uploaded_at timestamptz NOT NULL,
 uploaded_by uuid NOT NULL,
 archived_at timestamptz,
 PRIMARY KEY(tenant_id,id),
 UNIQUE(storage_key),
 FOREIGN KEY(tenant_id,uploaded_by) REFERENCES users(tenant_id,id),
 CHECK(state <> 'archived' OR archived_at IS NOT NULL),
 CHECK(state <> 'available' OR archived_at IS NULL)
);
CREATE INDEX library_files_list ON library_files(tenant_id,state,uploaded_at DESC);
-- A retried upload names its attempt; the stored response makes the retry
-- return the same row instead of writing a second one (pattern of 0037).
CREATE TABLE library_file_upload_operations (
 tenant_id uuid NOT NULL REFERENCES tenants(id),
 request_id uuid NOT NULL,
 request_hash text NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),
 response jsonb NOT NULL CHECK(jsonb_typeof(response) = 'object'),
 PRIMARY KEY(tenant_id,request_id)
);
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
 'file.uploaded','file.archived'
));

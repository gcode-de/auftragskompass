-- MAIL-SIG-01a: mail signatures. Additive only: one new tenant-bound table,
-- one partial unique index and one widened audit vocabulary; no existing row
-- changes. A signature is text in the mail allowlist plus an optional logo.
-- The logo bytes live in the storage adapter; the row keeps key, type, size
-- and hash so a mail can later freeze exactly these bytes as an inline image.
CREATE TABLE mail_signatures (
 tenant_id uuid NOT NULL REFERENCES tenants(id),
 id uuid NOT NULL,
 name text NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 120),
 -- Sanitized before it is stored (mail allowlist); `{{logo}}` marks where the
 -- logo stands and is the only token a signature knows.
 body_html text NOT NULL DEFAULT '' CHECK(length(body_html)<=50000),
 logo_key text CHECK(logo_key ~ '^[a-z0-9][a-z0-9._-]{0,127}$'),
 logo_media_type text CHECK(logo_media_type IN ('image/png','image/jpeg')),
 logo_size_bytes integer CHECK(logo_size_bytes BETWEEN 1 AND 524288),
 logo_sha256 text CHECK(logo_sha256 ~ '^[a-f0-9]{64}$'),
 -- Optional target of the logo; empty means the logo is not a link.
 logo_link text NOT NULL DEFAULT '' CHECK(length(logo_link)<=2000),
 is_default boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,id),
 -- The four logo columns exist together or not at all.
 CHECK(
   (logo_key IS NULL AND logo_media_type IS NULL AND logo_size_bytes IS NULL
     AND logo_sha256 IS NULL)
   OR (logo_key IS NOT NULL AND logo_media_type IS NOT NULL
     AND logo_size_bytes IS NOT NULL AND logo_sha256 IS NOT NULL)
 )
);
-- At most one standard signature per tenant, guarded by the database.
CREATE UNIQUE INDEX mail_signatures_one_default
  ON mail_signatures(tenant_id) WHERE is_default;
-- One widened closed vocabulary in the established 0074 pattern; every
-- earlier action keeps its meaning, one is added.
ALTER TABLE audit_events DROP CONSTRAINT audit_events_action_check;
ALTER TABLE audit_events ADD CONSTRAINT audit_events_action_check CHECK(action IN (
 'login.succeeded','login.denied','login.failed','logout','master_data.created','master_data.updated',
 'resource.created','resource.updated','product.created','product.updated','product.deleted','contact.created','contact.updated',
 'location.created','location.updated','event.created','event.updated','reservation.created','reservation.updated','reservation.expired',
 'import.created','import.updated','import.reviewed','password.changed','password.change_denied','password.reset',
 'feed.created','feed.rotated','feed.revoked',
 'document_template.created','document_template.updated',
 'document_number.updated','document_layout.updated',
 'document.created','document.updated','document.finalized',
 'document.sent','document.accepted','document.withdrawn','document.acceptance_corrected',
 'file.uploaded','file.archived','payment.recorded','file.event_linked','file.event_unlinked',
 'event.removed','event.restored',
 'mail.message_created','mail.send_scheduled',
 'mail.sent','mail.send_retry',
 'mail.document_send_scheduled','mail.account_saved',
 'mail.template_saved','mail.signature_saved'
));

-- MAIL-TPL-01a: reusable mail templates. Additive only: one new tenant-bound
-- table and one widened audit vocabulary; no existing row changes. A template
-- is never deleted - archiving is a visible state like everywhere else.
CREATE TABLE mail_templates (
 tenant_id uuid NOT NULL REFERENCES tenants(id),
 id uuid NOT NULL,
 name text NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 120),
 -- Plain text with the documented placeholders; values are flattened to one
 -- line at resolution, so the header can never be split.
 subject text NOT NULL DEFAULT '' CHECK(length(subject)<=998),
 -- Sanitized before it is stored (mail-content allowlist), never raw client
 -- HTML. Size bound mirrors the document mail body.
 body_html text NOT NULL DEFAULT '' CHECK(length(body_html)<=200000),
 state text NOT NULL DEFAULT 'active'
   CHECK(state IN ('active','inactive','archived')),
 version integer NOT NULL DEFAULT 1 CHECK(version>=1),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,id)
);
-- One widened closed vocabulary in the established 0052/0064/0066/0067/0068/
-- 0071/0072 pattern; every earlier action keeps its meaning, one is added.
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
 'mail.template_saved'
));

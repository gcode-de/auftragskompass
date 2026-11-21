-- MAIL-021-A: durable mail core. Additive only: three new tenant-bound tables,
-- no backfill and no change to any existing row. Editing state, folder state and
-- send state are three separate axes (BKP021.a); the outbox owns the external
-- effect and never stores a provider token, address or response body.
CREATE TABLE mail_accounts (
 tenant_id uuid NOT NULL REFERENCES tenants(id),
 id uuid NOT NULL,
 name text NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 200),
 provider text NOT NULL DEFAULT '' CHECK(length(provider)<=100),
 imap_host text NOT NULL DEFAULT '' CHECK(length(imap_host)<=255),
 imap_port integer,
 smtp_host text NOT NULL DEFAULT '' CHECK(length(smtp_host)<=255),
 smtp_port integer,
 username text NOT NULL DEFAULT '' CHECK(length(username)<=255),
 -- Same AES-256-GCM envelope as telegram_settings: the secret is never stored
 -- as text, and no API ever returns these columns.
 secret_ciphertext bytea,
 secret_nonce bytea,
 secret_tag bytea,
 enabled boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,id),
 UNIQUE(tenant_id,name),
 CHECK(imap_port IS NULL OR imap_port BETWEEN 1 AND 65535),
 CHECK(smtp_port IS NULL OR smtp_port BETWEEN 1 AND 65535),
 CHECK(NOT enabled OR (secret_ciphertext IS NOT NULL AND secret_nonce IS NOT NULL AND secret_tag IS NOT NULL))
);
CREATE TABLE mail_messages (
 tenant_id uuid NOT NULL,
 id uuid NOT NULL,
 account_id uuid NOT NULL,
 direction text NOT NULL CHECK(direction IN ('in','out')),
 -- Where the message lives (physical folder), independent of the two other axes.
 folder text NOT NULL CHECK(folder IN ('inbox','drafts','sent','trash')),
 -- EM-04: unerledigt/erledigt is editorial, never implied by opening a mail.
 edit_state text NOT NULL DEFAULT 'open' CHECK(edit_state IN ('open','done')),
 -- Derived from the outbox, but stored so a list can filter without a join.
 send_state text NOT NULL DEFAULT 'none'
   CHECK(send_state IN ('none','scheduled','sending','sent','failed','uncertain')),
 subject text NOT NULL DEFAULT '' CHECK(length(subject)<=998),
 body_text text NOT NULL DEFAULT '' CHECK(length(body_text)<=200000),
 body_html text CHECK(body_html IS NULL OR length(body_html)<=400000),
 -- Documented text form: comma-separated addresses, validated before a row exists.
 from_address text NOT NULL DEFAULT '' CHECK(length(from_address)<=4000),
 to_addresses text NOT NULL DEFAULT '' CHECK(length(to_addresses)<=4000),
 cc_addresses text NOT NULL DEFAULT '' CHECK(length(cc_addresses)<=4000),
 bcc_addresses text NOT NULL DEFAULT '' CHECK(length(bcc_addresses)<=4000),
 -- IMAP links stay nullable until BKP021.b resolves UIDVALIDITY/UID/Message-ID.
 message_id text CHECK(message_id IS NULL OR length(message_id)<=998),
 imap_uid bigint CHECK(imap_uid IS NULL OR imap_uid>=0),
 thread_key text CHECK(thread_key IS NULL OR length(thread_key)<=998),
 contact_id uuid,
 event_id uuid,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 sent_at timestamptz,
 PRIMARY KEY(tenant_id,id),
 FOREIGN KEY(tenant_id,account_id) REFERENCES mail_accounts(tenant_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(tenant_id,contact_id) REFERENCES contacts(tenant_id,id),
 FOREIGN KEY(tenant_id,event_id) REFERENCES events(tenant_id,id),
 -- An incoming mail is in the inbox and has no send state of its own.
 CHECK(direction='out' OR (folder='inbox' AND send_state='none' AND sent_at IS NULL)),
 -- A sent folder row must actually be sent; a trashed sent mail keeps its state.
 CHECK(folder<>'sent' OR send_state='sent'),
 CHECK((send_state='sent')=(sent_at IS NOT NULL))
);
CREATE INDEX mail_messages_folder_idx ON mail_messages(tenant_id,folder,created_at DESC);
CREATE INDEX mail_messages_contact_idx ON mail_messages(tenant_id,contact_id) WHERE contact_id IS NOT NULL;
CREATE INDEX mail_messages_event_idx ON mail_messages(tenant_id,event_id) WHERE event_id IS NOT NULL;
CREATE INDEX mail_messages_thread_idx ON mail_messages(tenant_id,thread_key) WHERE thread_key IS NOT NULL;
CREATE TABLE mail_outbox (
 tenant_id uuid NOT NULL,
 id uuid NOT NULL,
 message_id uuid NOT NULL,
 idempotency_key text NOT NULL CHECK(length(trim(idempotency_key)) BETWEEN 1 AND 200),
 state text NOT NULL DEFAULT 'pending'
   CHECK(state IN ('pending','sending','sent','failed','uncertain')),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0),
 next_attempt_at timestamptz NOT NULL DEFAULT now(),
 -- Redacted diagnosis only: a closed code set, never a message, address or token.
 last_error_code text,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 locked_at timestamptz,
 sent_at timestamptz,
 PRIMARY KEY(tenant_id,id),
 -- One key means one job, also under parallel requests.
 UNIQUE(tenant_id,idempotency_key),
 FOREIGN KEY(tenant_id,message_id) REFERENCES mail_messages(tenant_id,id) ON DELETE CASCADE,
 CHECK(last_error_code IS NULL OR last_error_code IN
   ('provider_missing','provider_timeout','provider_rejected','provider_uncertain','internal')),
 CHECK(last_error_code IS NULL OR state IN ('failed','uncertain')),
 CHECK((state='sent')=(sent_at IS NOT NULL))
);
-- At most one open job per message: a retry is the same job, not a second send.
CREATE UNIQUE INDEX mail_outbox_one_open_idx ON mail_outbox(tenant_id,message_id)
  WHERE state IN ('pending','sending','failed');
CREATE INDEX mail_outbox_due_idx ON mail_outbox(next_attempt_at,created_at)
  WHERE state IN ('pending','sending','failed');
-- MAIL-021-A widens the closed audit action list in the established 0052/0064/
-- 0066 pattern: every earlier action keeps its meaning, two are added.
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
 'mail.message_created','mail.send_scheduled'
));

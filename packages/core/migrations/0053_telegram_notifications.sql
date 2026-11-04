CREATE TABLE telegram_settings (
 tenant_id uuid PRIMARY KEY REFERENCES tenants(id),
 token_ciphertext bytea,
 token_nonce bytea,
 token_tag bytea,
 chat_id text NOT NULL,
 enabled boolean NOT NULL DEFAULT false,
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK ((enabled AND token_ciphertext IS NOT NULL AND token_nonce IS NOT NULL AND token_tag IS NOT NULL) OR (NOT enabled))
);
CREATE TABLE telegram_notification_jobs (
 tenant_id uuid NOT NULL,
 inquiry_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 available_at timestamptz NOT NULL DEFAULT now(),
 attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
 locked_at timestamptz,
 delivered_at timestamptz,
 cancelled_at timestamptz,
 PRIMARY KEY (tenant_id, inquiry_id),
 FOREIGN KEY (tenant_id, inquiry_id) REFERENCES website_inquiry_deliveries(tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX telegram_notification_jobs_pending_idx ON telegram_notification_jobs(available_at, created_at) WHERE delivered_at IS NULL AND cancelled_at IS NULL;

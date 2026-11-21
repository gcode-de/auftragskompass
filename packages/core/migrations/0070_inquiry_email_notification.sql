-- MAIL-NOTIFY-01: opt-in e-mail notification for newly received website
-- inquiries. Additive only: one tenant-bound row per tenant, no backfill and no
-- change to an existing row. The target addresses use the documented
-- comma-separated text form of mail_messages and are validated before a row
-- exists; no credential is stored here.
CREATE TABLE inquiry_email_settings (
 tenant_id uuid PRIMARY KEY REFERENCES tenants(id),
 recipients text NOT NULL DEFAULT '' CHECK(length(recipients)<=4000),
 enabled boolean NOT NULL DEFAULT false,
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(NOT enabled OR length(trim(recipients)) BETWEEN 3 AND 4000)
);

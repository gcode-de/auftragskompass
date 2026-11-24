-- MAIL-FWD-01: where an outgoing mail can additionally be sent - the
-- accounting address. The operator switches the forwarding per mail in the
-- composer; this row only stores the address. An empty address means the
-- switch is not available, never a guessed recipient. The address is
-- validated like every other mail address on the way in.
CREATE TABLE mail_forward_settings (
 tenant_id uuid PRIMARY KEY REFERENCES tenants(id),
 accounting_recipient text NOT NULL DEFAULT ''
   CHECK(length(accounting_recipient) <= 4000),
 updated_at timestamptz NOT NULL DEFAULT now()
);

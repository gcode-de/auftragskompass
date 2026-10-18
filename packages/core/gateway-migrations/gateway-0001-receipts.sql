-- Separate gateway database: no customer, user, event or reservation tables.
CREATE TABLE ak_gateway_messages (
  tenant_id uuid NOT NULL,
  direction text NOT NULL CHECK (direction IN ('core-to-gateway', 'gateway-to-core')),
  message_id uuid NOT NULL,
  issued_at bigint NOT NULL CHECK (issued_at BETWEEN 0 AND 9007199254740991),
  received_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, direction, message_id)
);
CREATE INDEX ak_gateway_messages_received_at ON ak_gateway_messages (received_at);

CREATE TABLE ak_gateway_operations (
  tenant_id uuid NOT NULL,
  direction text NOT NULL,
  operation_id uuid NOT NULL,
  kind text NOT NULL,
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  effect_count integer NOT NULL CHECK (effect_count BETWEEN 0 AND 100),
  processed_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, direction, operation_id),
  CHECK ((direction = 'core-to-gateway' AND kind IN ('inquiries.pull', 'inquiries.ack'))
    OR (direction = 'gateway-to-core' AND kind = 'inquiries.batch'))
);

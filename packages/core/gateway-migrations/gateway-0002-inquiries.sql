CREATE TABLE ak_gateway_inquiries (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  form_id text NOT NULL CHECK (form_id ~ '^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$'),
  form_version integer NOT NULL CHECK (form_version > 0),
  key_id text NOT NULL CHECK (key_id ~ '^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$'),
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  received_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  acknowledged_at timestamptz,
  ciphertext text,
  iv text,
  tag text,
  PRIMARY KEY (tenant_id, id),
  CHECK (expires_at > received_at AND expires_at <= received_at + interval '168 hours'),
  CHECK ((acknowledged_at IS NULL AND ciphertext IS NOT NULL AND iv IS NOT NULL AND tag IS NOT NULL)
    OR (acknowledged_at IS NOT NULL AND ciphertext IS NULL AND iv IS NULL AND tag IS NULL)),
  CHECK (ciphertext IS NULL OR octet_length(ciphertext) BETWEEN 1 AND 65536),
  CHECK (iv IS NULL OR iv ~ '^[A-Za-z0-9_-]{16}$'),
  CHECK (tag IS NULL OR tag ~ '^[A-Za-z0-9_-]{22}$')
);
CREATE INDEX ak_gateway_inquiries_pending ON ak_gateway_inquiries (tenant_id, received_at, id)
  WHERE acknowledged_at IS NULL;
CREATE INDEX ak_gateway_inquiries_expiry ON ak_gateway_inquiries (tenant_id, expires_at);

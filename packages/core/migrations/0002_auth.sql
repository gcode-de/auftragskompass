CREATE TABLE login_attempts (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  state_hash text NOT NULL,
  binding_hash text NOT NULL,
  verifier text NOT NULL,
  nonce text NOT NULL,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, state_hash)
);
CREATE INDEX login_attempt_expiry ON login_attempts(expires_at);
CREATE TABLE sessions (
  tenant_id uuid NOT NULL,
  token_hash text NOT NULL,
  user_id uuid NOT NULL,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, token_hash),
  FOREIGN KEY (tenant_id, user_id) REFERENCES memberships(tenant_id, user_id)
);
CREATE INDEX session_expiry ON sessions(expires_at);

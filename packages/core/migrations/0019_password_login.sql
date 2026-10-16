-- Local identities have no Google subject; existing OIDC bindings are preserved.
ALTER TABLE users ALTER COLUMN google_subject DROP NOT NULL;
CREATE TABLE password_credentials (
  tenant_id uuid NOT NULL,
  user_id uuid NOT NULL,
  username text NOT NULL CHECK (username ~ '^[a-z0-9][a-z0-9._-]{2,63}$'),
  password_hash text NOT NULL CHECK (password_hash ~ '^scrypt:131072:8:1:[a-f0-9]{32}:[a-f0-9]{128}$'),
  failures integer NOT NULL DEFAULT 0 CHECK (failures BETWEEN 0 AND 5),
  locked_until timestamptz,
  PRIMARY KEY (tenant_id, user_id),
  UNIQUE (tenant_id, username),
  FOREIGN KEY (tenant_id, user_id) REFERENCES users(tenant_id, id)
);
CREATE TABLE password_bootstrap (
  tenant_id uuid PRIMARY KEY REFERENCES tenants(id)
);

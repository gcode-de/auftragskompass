CREATE TABLE tenants (
  id uuid PRIMARY KEY,
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 200),
  timezone text NOT NULL
);
CREATE TABLE users (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  id uuid NOT NULL,
  google_subject text NOT NULL CHECK (length(google_subject) BETWEEN 1 AND 255),
  email text NOT NULL CHECK (email = lower(trim(email)) AND length(email) BETWEEN 3 AND 254),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, google_subject),
  UNIQUE (tenant_id, email)
);
CREATE TABLE memberships (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  user_id uuid NOT NULL,
  role text NOT NULL DEFAULT 'administrator' CHECK (role = 'administrator'),
  active boolean NOT NULL DEFAULT true,
  PRIMARY KEY (tenant_id, user_id),
  FOREIGN KEY (tenant_id, user_id) REFERENCES users(tenant_id, id)
);

CREATE TABLE allowed_accounts (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  id uuid NOT NULL,
  email text NOT NULL CHECK (email = lower(trim(email)) AND length(email) BETWEEN 3 AND 254),
  active boolean NOT NULL DEFAULT true,
  user_id uuid,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, email),
  UNIQUE (tenant_id, user_id),
  FOREIGN KEY (tenant_id, user_id) REFERENCES users(tenant_id, id)
);
CREATE TABLE access_bootstrap (
  tenant_id uuid PRIMARY KEY REFERENCES tenants(id)
);
CREATE TABLE access_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  actor_id uuid,
  target_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('bootstrap','migration','claim','grant','enable','disable')),
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (tenant_id, actor_id) REFERENCES users(tenant_id, id),
  FOREIGN KEY (tenant_id, target_id) REFERENCES allowed_accounts(tenant_id, id)
);
CREATE FUNCTION reject_access_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'access audit is immutable' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER access_audit_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON access_audit
  FOR EACH STATEMENT EXECUTE FUNCTION reject_access_audit_mutation();
-- Preserve explicitly provisioned C009 identities, including existing blocks.
INSERT INTO allowed_accounts (tenant_id, id, email, active, user_id)
SELECT u.tenant_id, u.id, u.email, m.active, u.id FROM users u JOIN memberships m ON m.tenant_id=u.tenant_id AND m.user_id=u.id;
INSERT INTO access_bootstrap SELECT DISTINCT tenant_id FROM allowed_accounts;
INSERT INTO access_audit (tenant_id, target_id, action) SELECT tenant_id, id, 'migration' FROM allowed_accounts;
-- Defense in depth for direct updates; service mutations acquire the same lock.
CREATE FUNCTION protect_last_allowed_admin() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.tenant_id::text, 814022));
  IF NOT EXISTS (
    SELECT 1 FROM allowed_accounts a JOIN memberships m ON m.tenant_id=a.tenant_id AND m.user_id=a.user_id
    WHERE a.tenant_id=NEW.tenant_id AND a.id<>NEW.id AND a.active AND m.active
  ) THEN
    RAISE EXCEPTION 'last administrator' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER last_allowed_admin BEFORE UPDATE OF active ON allowed_accounts
  FOR EACH ROW WHEN (OLD.active AND NOT NEW.active AND OLD.user_id IS NOT NULL)
  EXECUTE FUNCTION protect_last_allowed_admin();
CREATE FUNCTION protect_last_admin_membership() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.tenant_id::text, 814022));
  IF EXISTS (SELECT 1 FROM allowed_accounts WHERE tenant_id=NEW.tenant_id AND user_id=NEW.user_id AND active)
     AND NOT EXISTS (
       SELECT 1 FROM allowed_accounts a JOIN memberships m ON m.tenant_id=a.tenant_id AND m.user_id=a.user_id
       WHERE a.tenant_id=NEW.tenant_id AND a.user_id<>NEW.user_id AND a.active AND m.active
     ) THEN
    RAISE EXCEPTION 'last administrator' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER last_admin_membership BEFORE UPDATE OF active ON memberships
  FOR EACH ROW WHEN (OLD.active AND NOT NEW.active)
  EXECUTE FUNCTION protect_last_admin_membership();

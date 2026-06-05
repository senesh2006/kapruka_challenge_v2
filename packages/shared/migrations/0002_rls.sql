-- Sevana — row-level security for tenant isolation.
--
-- Application connections MUST execute
--     SET app.tenant_id = '<tenant-id>'
-- per transaction (or per session). Every per-tenant table refuses rows whose
-- tenant_id does not match the setting. This is the database-side companion
-- to the application-side TenantScope guard.

BEGIN;

-- Helper that returns the current tenant id, or raises if unset.
CREATE OR REPLACE FUNCTION current_tenant_id() RETURNS TEXT
LANGUAGE plpgsql STABLE AS $$
DECLARE
  tid TEXT;
BEGIN
  tid := current_setting('app.tenant_id', true);
  IF tid IS NULL OR tid = '' THEN
    RAISE EXCEPTION 'app.tenant_id is not set'
      USING ERRCODE = '42501';
  END IF;
  RETURN tid;
END;
$$;

-- customer_profiles
ALTER TABLE customer_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_profiles FORCE ROW LEVEL SECURITY;
CREATE POLICY customer_profiles_tenant_isolation ON customer_profiles
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- sessions
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions FORCE ROW LEVEL SECURITY;
CREATE POLICY sessions_tenant_isolation ON sessions
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- recommendations
ALTER TABLE recommendations ENABLE ROW LEVEL SECURITY;
ALTER TABLE recommendations FORCE ROW LEVEL SECURITY;
CREATE POLICY recommendations_tenant_isolation ON recommendations
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- orders
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders FORCE ROW LEVEL SECURITY;
CREATE POLICY orders_tenant_isolation ON orders
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- events
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE events FORCE ROW LEVEL SECURITY;
CREATE POLICY events_tenant_isolation ON events
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- tenants table is NOT under RLS by tenant_id: a tenant row is keyed by id,
-- and an authenticated session for tenant T may only read its own row. The
-- application enforces this with TenantScope.assertIsThisTenant.

COMMIT;

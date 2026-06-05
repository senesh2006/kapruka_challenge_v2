# Migrations — Postgres

Schema for the per-tenant data model from the PRD. Numbered SQL files are applied in order; pick any migration runner (`psql -f`, `node-pg-migrate`, `sqlx`, Flyway, etc.).

| File | Purpose |
|---|---|
| `0001_init.sql` | Tables for `tenants`, `customer_profiles`, `sessions`, `recommendations`, `orders`, `events`. Every per-tenant table includes `tenant_id` and an index on it; composite primary keys are `(tenant_id, id)` so cross-tenant id collisions are impossible. |
| `0002_rls.sql` | Enables and **forces** row-level security on every per-tenant table. Policies require `tenant_id = current_setting('app.tenant_id')`, raising if unset. This is the database-side counterpart to `TenantScope` in `@sevana/shared/guard`. |

## Connection contract

Every transaction (or session) opened by application code MUST set the tenant context before issuing the first query:

```sql
SET app.tenant_id = 'kapruka';
```

If the setting is missing, `current_tenant_id()` raises and the query fails. Use `SET LOCAL` inside a transaction to scope it tightly.

## Defence in depth

`TenantScope` enforces isolation in the application layer (typed errors, easy to test). RLS enforces it in the database (catches any code path that forgets the guard). Both must agree.

# @sevana/shared

Shared types, the PRD data model, the tenant-isolation guard, and runtime config for the Sevana monorepo. Schemas use Zod so each entity has both a runtime validator and an inferred static type.

## Exports

- `@sevana/shared/model` — `Tenant`, `CustomerProfile`, `Session`, `Recommendation` / `Look`, `OrderContext`, and the discriminated `Event` union. Every per-tenant entity carries a `tenantId`.
- `@sevana/shared/guard` — `TenantScope`, `CrossTenantAccessError`, and `guardedRead` / `guardedList` / `guardedWrite` helpers.
- `@sevana/shared/config` — `loadRuntimeConfig` for environment variables.

## Tenant guard

All data access must funnel through `TenantScope`. Any entity whose `tenantId` does not match the scope is refused with a `CrossTenantAccessError`.

```ts
import { TenantScope, guardedRead } from "@sevana/shared";

const scope = new TenantScope(req.tenantId);

// app-level enforcement of tenant isolation
const session = await guardedRead(scope, () => db.findSession(sessionId));
// throws CrossTenantAccessError if a row from another tenant slipped through
```

The Postgres migrations in `./migrations` add row-level security as a second line of defence: queries must run with `SET app.tenant_id = '<tenant>'`, and policies refuse rows where `tenant_id` doesn't match.

## Migrations

See [`./migrations/README.md`](./migrations/README.md). Numbered SQL files for Postgres 15+:

- `0001_init.sql` — tables for every PRD entity with `(tenant_id, id)` composite primary keys.
- `0002_rls.sql` — enables and **forces** row-level security; defines per-table policies.

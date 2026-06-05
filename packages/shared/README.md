# @sevana/shared

Shared types, the PRD data model, and runtime config for the Sevana monorepo. Schemas use Zod so each entity has both a runtime validator and an inferred static type.

Exports:

- `model/` — `Tenant`, `CustomerProfile`, `Session`, `Recommendation` / `Look`, `OrderContext`, `Event` union.
- `config/` — `loadRuntimeConfig` for tenant/runtime environment variables.

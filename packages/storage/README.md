# @sevana/storage

Vercel Blob–backed persistence for Sevana. Houses all the per-tenant data (tenants, sessions, customer profiles, events, orders) plus the webhook idempotency store and the storage-backed Retention agent.

## Architecture

```
@sevana/storage
  ├── BlobStorageAdapter         abstract
  │     ├── VercelBlobAdapter    @vercel/blob (production)
  │     └── InMemoryBlobAdapter  tests + previews without BLOB_READ_WRITE_TOKEN
  ├── BlobBackedStore<T>         generic tenant-scoped store
  │     • path = {prefix}/{tenantId}/{id}.json
  │     • TenantScope enforced on every read AND write
  ├── repositories/              concrete per-entity wrappers
  │     ├── TenantRepository           tenants/{id}.json
  │     ├── SessionRepository          sessions/{tenantId}/{id}.json
  │     ├── CustomerProfileRepository  customers/{tenantId}/{id}.json
  │     ├── EventRepository            events/{tenantId}/{id}.json
  │     └── OrderRepository            orders/{tenantId}/{id}.json
  ├── BlobIdempotencyStore       implements IdempotencyStore from
  │                              @sevana/connectors/webhooks; persists
  │                              tryReserve/commit/release in Blob
  └── StorageRetentionAgent      implements RetentionAgent from
                                 @sevana/orchestrator; reads/writes
                                 consented CustomerProfile
```

## Tenant isolation

Every per-tenant blob path includes `{tenantId}` as a path segment, so a query scoped to one tenant cannot even see another's blobs. On top of that, every read goes through `TenantScope.assertOwns` — if a blob's parsed `tenantId` doesn't match the active scope, a `CrossTenantAccessError` is thrown. Writes are checked the same way before they hit Blob.

## Caveats — Blob is an object store, not a transactional KV

- `BlobIdempotencyStore.tryReserve` is best-effort. Two concurrent webhook deliveries arriving within the same millisecond may both succeed. Acceptable for a Phase-1 pilot; for high throughput swap in Vercel KV / Upstash Redis (proper atomic SETNX).
- `Blob` has no secondary indexes or queries. Listing is by prefix only. For analytics queries (aggregations, joins, time-range scans) the event log should be mirrored into a columnar store (BigQuery, ClickHouse).
- Vercel Blob's `access: "public"` mode means anyone with the URL can read the body. Pathnames are predictable in this implementation, so for customer PII production should either: (a) front Blob reads through authenticated edge functions, or (b) switch to a private backend for the `customers/` prefix.

## Usage

```ts
import {
  VercelBlobAdapter,
  CustomerProfileRepository,
  StorageRetentionAgent,
} from "@sevana/storage";
import { TenantScope } from "@sevana/shared";

const vercelBlob = await import("@vercel/blob");
const adapter = new VercelBlobAdapter({
  vercelBlob,
  token: process.env.BLOB_READ_WRITE_TOKEN,
});

const customers = new CustomerProfileRepository(adapter);
const scope = new TenantScope(tenantId);

await customers.upsert(profile, scope);             // consent-gated by the agent
const fetched = await customers.get(customerId, scope);
await customers.delete(customerId, scope);          // FR-14 "delete my data"
```

## Tests

17 covering: tenant repo round-trip, path-level isolation, cross-tenant write rejection, scoped list, empty get, view/edit/delete, append-only event log, idempotency tryReserve/release/TTL-expiry, retention consent gate (no-customer / no-consent / persisted), Vercel adapter wire shape against an injected `@vercel/blob` module.

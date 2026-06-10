# @sevana/connectors

## Webhooks

`@sevana/connectors/webhooks` ingests order, payment, and fulfilment events from a retailer (PRD §10).

- **Signature verification** — `HmacSha256Verifier` with timing-safe compare; optional timestamp tolerance to prevent replay.
- **Per-tenant secrets** — resolved through `WebhookSecretResolver` (channels never see keys).
- **Idempotency** — `IdempotencyStore.tryReserve` + `commit` / `release`. A reservation is created before publish; on publish failure the reservation is released so the retailer's redelivery is reprocessed.
- **Internal retry** — exponential backoff when the event bus rejects a publish.
- **Mapping** — `KaprukaWebhookMapper` (default) maps `order.*`, `payment.*`, `fulfilment.*` event types onto the canonical `Event` union from `@sevana/shared`. Each event carries the resolved `tenantId`.
- **Bus** — `InMemoryEventBus` (`subscribe(kind | "*", handler)`, `publish(event)`). Analytics and retention services subscribe here.

`WebhookReceiver.handle({ tenantId, rawBody, headers })` returns one of:
- `{ status: "accepted", event }` — verified, mapped, published.
- `{ status: "duplicate", eventId }` — already processed.
- `{ status: "rejected", code, reason }` — `signature` / `tenant` / `payload` / `unsupported` / `no-event-id`.

A bus publish failure that exhausts retry propagates as a thrown error — the HTTP layer can return 5xx and the retailer retries.

---



Transport-agnostic connector contract that any retailer can implement. The orchestrator only ever talks to a `RetailerConnector` — never to a raw MCP, REST, or gRPC client — so transports can be swapped per tenant without touching agent code.

## Capability groups

The contract is split into four capability groups, each its own interface:

### Catalogue — `CatalogueConnector`

| Method | Input | Returns |
|---|---|---|
| `searchProducts(intent)` | `SearchIntent` (free text, categories, occasion, budget, attributes, locale, limit, cursor) | `Promise<SearchResult>` — page of `ProductSummary` plus optional `cursor` |
| `getProduct(id)` | `ProductId` | `Promise<Product \| null>` — full detail, or `null` if not found |
| `listCategories()` | — | `Promise<Category[]>` — top-of-tree categories with `parentId` links |

The contract requires real catalogue rows only — no invented products or prices (PRD FR-4).

### Delivery — `DeliveryConnector`

| Method | Input | Returns |
|---|---|---|
| `listDeliveryCities()` | — | `Promise<DeliveryCity[]>` — canonical cities with vernacular aliases |
| `checkDelivery(city, date, items)` | city id or name, ISO date, `DeliveryQuoteLine[]` | `Promise<DeliveryQuote>` — availability, earliest date, fee, perishable warnings, optional reason |

### Checkout — `CheckoutConnector`

| Method | Input | Returns |
|---|---|---|
| `createOrder(orderContext)` | canonical `OrderContext` from `@sevana/shared` | `Promise<OrderConfirmation>` — retailer order ref, **pay link**, expected total |
| `trackOrder(id)` | Sevana `OrderId` or retailer reference | `Promise<OrderTracking>` — current status + timeline |

Sevana never handles payment directly; the customer follows the retailer's pay link.

### Identity / CRM — `CrmConnector` *(optional)*

| Method | Input | Returns |
|---|---|---|
| `findCustomer(lookup)` | email / phone / retailer id | `Promise<CrmCustomerSnapshot \| null>` |
| `upsertProfile(profile)` | Sevana `CustomerProfile` (consent required) | `Promise<CrmCustomerSnapshot>` |

CRM is the only optional capability — `RetailerConnector.crm` is `undefined` when the tenant has no binding.

## Default transport: MCP

The PRD anchors on the Kapruka MCP, and the MCP pattern is the default implementation style. `@sevana/connectors/mcp` exposes:

- `McpClient` — the tiny interface a transport must satisfy (`callTool<T>(name, args): Promise<T>`).
- `DEFAULT_MCP_TOOL_NAMES` — the Kapruka tool names (`kapruka_search_products`, `kapruka_create_order`, …).
- `createMcpCatalogueConnector(client, toolNames?)` and three sibling builders for delivery / checkout / CRM.

Every MCP response is Zod-validated before reaching the orchestrator — connectors are a trust boundary.

A REST-backed adapter (or any other transport) implements the same four interfaces and registers itself with the registry; the orchestrator can't tell the difference.

### REST adapter (PRD §12.2)

`@sevana/connectors/rest` proves the contract holds beyond Kapruka: where Kapruka speaks MCP tools with snake_case payloads, this adapter speaks a conventional camelCase REST API (`GET /products?q=`, `POST /shipping/quote`, `POST /orders`, …) and normalises onto the same canonical types. `registerRestAdapter(registry, { buildClient })` mirrors `registerKaprukaAdapter` exactly — both transports register on one registry and serve different tenants side by side. The credential payload carries `baseUrl` (and optionally `apiKey`) so each REST tenant points at its own API host: all config, no code. Deliberately a contract proof, not production hardening — it has timeouts and Zod validation but no rate limiting or caching; a real second retailer would get a transport stack like `KaprukaTransport` tuned to their limits.

### Kapruka adapter

`@sevana/connectors/kapruka` is the production Kapruka MCP adapter. It wires `catalogue`, `delivery`, and `checkout` (no CRM — Kapruka MCP doesn't expose CRM tools) onto a shared per-tenant `KaprukaTransport` that enforces:

- **Rate limits** — sliding-window limiter: 60 req/min global, 30 `kapruka_create_order` calls per hour (PRD NFR-8). Concurrent callers queue.
- **Exponential backoff** — retries transient errors with jittered backoff up to `maxAttempts` (default 4); Zod validation errors are NOT retried.
- **Caching** — short TTL on `search` (60s), `getProduct` (5m), `listCategories` / `listDeliveryCities` (30m). `checkDelivery` and the checkout tools are never cached.
- **Result normalisation** — every Kapruka raw response (snake_case fields, `price_lkr`, `pay_link`, …) is mapped onto the canonical Sevana types. When the MCP returns nothing, the connector returns an explicit empty result — never invented products or prices.
- **Fault injection** — `transport.fault.setOutage(true)` throws `KaprukaOutageError` immediately so fallback paths can be exercised; `setFailNext(n)` simulates transient failures to exercise backoff.
- **Credential isolation** — the credential lives inside the `McpClient` closure built by `buildClient(credential)`; no public surface (transport, connector, retailer) exposes it. Channels never see keys.

```ts
import { ConnectorRegistry, registerKaprukaAdapter } from "@sevana/connectors";

const registry = new ConnectorRegistry();
const handle = registerKaprukaAdapter(registry, {
  buildClient: (cred) => makeHttpMcpClient(cred.apiKey!, process.env.KAPRUKA_MCP_BASE_URL!),
});

const retailer = await registry.resolve(tenant, { credentialResolver });
const results  = await retailer.catalogue.searchProducts({ query: "birthday cake", limit: 10 });
const order    = await retailer.checkout.createOrder(orderContext);
// order.payLink is the Kapruka pay link the customer follows

// Ops only — not exposed to channels:
handle.getTransport(tenant.id)?.clearCache();
```

## Registry

```ts
import { ConnectorRegistry, createMcpCatalogueConnector } from "@sevana/connectors";

const registry = new ConnectorRegistry()
  .register({
    kind: "catalogue",
    adapter: "mcp",
    build: ({ credential }) => createMcpCatalogueConnector(makeMcpClient(credential)),
  })
  .register({ kind: "delivery",  adapter: "mcp", build: ({ credential }) => createMcpDeliveryConnector(makeMcpClient(credential)) })
  .register({ kind: "checkout",  adapter: "mcp", build: ({ credential }) => createMcpCheckoutConnector(makeMcpClient(credential)) });

const retailer = await registry.resolve(tenant, { credentialResolver });
const results  = await retailer.catalogue.searchProducts({ query: "birthday cake", limit: 10 });
```

The registry reads `tenant.connectors` (each binding has `kind`, `adapter`, `credentialRef`), looks up the right factory by `(kind, adapter)`, resolves credentials via the injected `CredentialResolver`, and assembles the `RetailerConnector`.

Errors raised:

- `UnknownConnectorAdapterError` — tenant binding references an adapter no factory has registered.
- `MissingConnectorBindingError` — tenant has no binding for a required capability (catalogue / delivery / checkout).
- `MissingCredentialError` — `credentialRef` is not present on the tenant's `credentials` list.

# @sevana/connectors

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

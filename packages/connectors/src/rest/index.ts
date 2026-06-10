import { z } from "zod";
import type { OrderContext, OrderId, ProductId, TenantId } from "@sevana/shared";
import type { CatalogueConnector } from "../catalogue/index.js";
import type { CheckoutConnector } from "../checkout/index.js";
import type { DeliveryConnector } from "../delivery/index.js";
import type {
  Category,
  DeliveryCity,
  DeliveryQuote,
  DeliveryQuoteLine,
  OrderConfirmation,
  OrderTracking,
  Product,
  ProductSummary,
  SearchIntent,
  SearchResult,
} from "../types/index.js";
import type { ConnectorRegistry, CredentialPayload } from "../registry/index.js";

/**
 * Generic REST retailer adapter (PRD §12.2).
 *
 * Proves the connector contract is transport-agnostic: where Kapruka speaks
 * MCP tools with snake_case payloads, this adapter speaks a conventional
 * camelCase REST API:
 *
 *   GET  {base}/categories
 *   GET  {base}/products?q=&category=&limit=&cursor=
 *   GET  {base}/products/{sku}
 *   GET  {base}/shipping/cities
 *   POST {base}/shipping/quote        { city, date, items }
 *   POST {base}/orders                { order }
 *   GET  {base}/orders/{ref}
 *
 * The orchestrator can't tell the difference — both register against the
 * same ConnectorRegistry and emerge as a RetailerConnector.
 *
 * Deliberately a contract proof, not production hardening: it has timeouts
 * and Zod-validated normalisation but no rate limiting or caching. A real
 * second retailer would get a transport stack like KaprukaTransport tuned
 * to their limits.
 */

export class RestRetailerClientError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super(message);
    this.name = "RestRetailerClientError";
  }
}

export interface RestRetailerClientOptions {
  baseUrl: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export class RestRetailerClient {
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(opts: RestRetailerClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.apiKey = opts.apiKey;
    this.fetchImpl = opts.fetchImpl ?? fetch.bind(globalThis);
    this.timeoutMs = opts.timeoutMs ?? 15_000;
  }

  async request<T = unknown>(
    method: "GET" | "POST",
    path: string,
    opts: { query?: Record<string, string | number | undefined>; body?: unknown } = {},
  ): Promise<{ status: number; data: T }> {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [k, v] of Object.entries(opts.query ?? {})) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(url.toString(), {
        method,
        headers: {
          accept: "application/json",
          ...(opts.body !== undefined ? { "content-type": "application/json" } : {}),
          ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
        },
        ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
        signal: controller.signal,
      });
      const data: unknown = await response.json().catch(() => null);
      if (!response.ok && response.status !== 404) {
        throw new RestRetailerClientError(
          `REST ${method} ${path} failed (${response.status})`,
          response.status,
          data,
        );
      }
      return { status: response.status, data: data as T };
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        throw new RestRetailerClientError(
          `REST ${method} ${path} timed out after ${this.timeoutMs}ms`,
          0,
          null,
        );
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}

// ---------------- raw REST shapes (camelCase) + normalisation ----------------

const RawProductSchema = z.object({
  sku: z.string().min(1),
  name: z.string(),
  image: z.string().url(),
  price: z.object({ value: z.number().nonnegative(), currency: z.string().length(3) }),
  categories: z.array(z.string()).default([]),
  inStock: z.boolean().default(true),
  description: z.string().optional(),
  gallery: z.array(z.string().url()).optional(),
  perishable: z.boolean().optional(),
});
type RawProduct = z.infer<typeof RawProductSchema>;

const RawSearchSchema = z.object({
  items: z.array(RawProductSchema).default([]),
  nextCursor: z.string().optional(),
});

const RawCategorySchema = z.object({
  id: z.string(),
  label: z.string(),
  parent: z.string().optional(),
});

const RawCitySchema = z.object({
  code: z.string(),
  city: z.string(),
  alsoKnownAs: z.array(z.string()).optional(),
});

const RawQuoteSchema = z.object({
  deliverable: z.boolean(),
  earliest: z.string().datetime().optional(),
  fee: z.object({ value: z.number().nonnegative(), currency: z.string().length(3) }).optional(),
  warnings: z.array(z.string()).optional(),
  message: z.string().optional(),
});

const RawOrderSchema = z.object({
  orderNumber: z.string().min(1),
  paymentUrl: z.string().url(),
  amount: z.object({ value: z.number().nonnegative(), currency: z.string().length(3) }),
});

const RawTrackingSchema = z.object({
  orderNumber: z.string().min(1),
  state: z.string(),
  history: z
    .array(z.object({ state: z.string(), timestamp: z.string().datetime(), note: z.string().optional() }))
    .optional(),
});

function rawToSummary(r: RawProduct): ProductSummary {
  return {
    id: r.sku as ProductSummary["id"],
    title: r.name,
    imageUrl: r.image,
    price: { amount: r.price.value, currency: r.price.currency.toUpperCase() as ProductSummary["price"]["currency"] },
    categoryIds: r.categories,
    available: r.inStock,
  };
}

function rawToProduct(r: RawProduct): Product {
  return {
    ...rawToSummary(r),
    ...(r.description !== undefined ? { description: r.description } : {}),
    images: r.gallery ?? [],
    attributes: {},
    perishable: r.perishable ?? false,
  };
}

// ---------------- capability connectors ----------------

export const REST_ADAPTER = "rest" as const;

export function createRestCatalogueConnector(client: RestRetailerClient): CatalogueConnector {
  return {
    kind: "catalogue",
    adapter: REST_ADAPTER,
    async searchProducts(intent: SearchIntent): Promise<SearchResult> {
      const { data } = await client.request("GET", "/products", {
        query: {
          q: intent.query,
          category: intent.categoryIds?.[0],
          limit: intent.limit,
          cursor: intent.cursor,
        },
      });
      if (data === null || data === undefined) return { items: [] };
      const parsed = RawSearchSchema.parse(data);
      return {
        items: parsed.items.map(rawToSummary),
        ...(parsed.nextCursor !== undefined ? { cursor: parsed.nextCursor } : {}),
      };
    },
    async getProduct(id: ProductId): Promise<Product | null> {
      const { status, data } = await client.request("GET", `/products/${encodeURIComponent(String(id))}`);
      if (status === 404 || data === null || data === undefined) return null;
      return rawToProduct(RawProductSchema.parse(data));
    },
    async listCategories(): Promise<Category[]> {
      const { data } = await client.request("GET", "/categories");
      if (data === null || data === undefined) return [];
      return z
        .array(RawCategorySchema)
        .parse(data)
        .map((c) => ({
          id: c.id,
          name: c.label,
          ...(c.parent !== undefined ? { parentId: c.parent } : {}),
        }));
    },
  };
}

export function createRestDeliveryConnector(client: RestRetailerClient): DeliveryConnector {
  return {
    kind: "delivery",
    adapter: REST_ADAPTER,
    async listDeliveryCities(): Promise<DeliveryCity[]> {
      const { data } = await client.request("GET", "/shipping/cities");
      if (data === null || data === undefined) return [];
      return z
        .array(RawCitySchema)
        .parse(data)
        .map((c) => ({ id: c.code, name: c.city, aliases: c.alsoKnownAs ?? [] }));
    },
    async checkDelivery(city: string, date: string, items: DeliveryQuoteLine[]): Promise<DeliveryQuote> {
      const { data } = await client.request("POST", "/shipping/quote", {
        body: { city, date, items },
      });
      if (data === null || data === undefined) {
        return { available: false, perishableWarnings: [], reason: "no response from REST API" };
      }
      const r = RawQuoteSchema.parse(data);
      return {
        available: r.deliverable,
        ...(r.earliest !== undefined ? { earliestDate: r.earliest } : {}),
        ...(r.fee !== undefined
          ? {
              fee: {
                amount: r.fee.value,
                currency: r.fee.currency.toUpperCase() as ProductSummary["price"]["currency"],
              },
            }
          : {}),
        perishableWarnings: r.warnings ?? [],
        ...(r.message !== undefined ? { reason: r.message } : {}),
      };
    },
  };
}

export function createRestCheckoutConnector(client: RestRetailerClient): CheckoutConnector {
  return {
    kind: "checkout",
    adapter: REST_ADAPTER,
    async createOrder(orderContext: OrderContext): Promise<OrderConfirmation> {
      const { data } = await client.request("POST", "/orders", { body: { order: orderContext } });
      const r = RawOrderSchema.parse(data);
      const currency = r.amount.currency.toUpperCase() as OrderConfirmation["currency"];
      return {
        retailerOrderRef: r.orderNumber,
        payLink: r.paymentUrl,
        currency,
        expectedTotal: { amount: r.amount.value, currency },
      };
    },
    async trackOrder(id: OrderId | string): Promise<OrderTracking> {
      const { data } = await client.request("GET", `/orders/${encodeURIComponent(String(id))}`);
      const r = RawTrackingSchema.parse(data);
      return {
        retailerOrderRef: r.orderNumber,
        currentStatus: r.state,
        timeline: (r.history ?? []).map((h) => ({
          status: h.state,
          at: h.timestamp,
          ...(h.note !== undefined ? { notes: h.note } : {}),
        })),
      };
    },
  };
}

// ---------------- registry wiring ----------------

export interface RestAdapterOptions {
  /**
   * Build a REST client from the tenant's resolved credential. The
   * credential payload carries `baseUrl` (and optionally `apiKey`) so each
   * REST tenant can point at its own API host — all config, no code.
   */
  buildClient: (credential: CredentialPayload) => RestRetailerClient;
}

export interface RestAdapterHandle {
  getClient(tenantId: TenantId): RestRetailerClient | undefined;
  evict(tenantId: TenantId): void;
}

/**
 * Registers the REST adapter for catalogue, delivery, and checkout on the
 * given registry — exactly mirroring registerKaprukaAdapter so both
 * transports can serve different tenants from one registry (PRD §12.2).
 */
export function registerRestAdapter(
  registry: ConnectorRegistry,
  options: RestAdapterOptions,
): RestAdapterHandle {
  const clients = new Map<string, RestRetailerClient>();

  const ensureClient = (tenantId: TenantId, credential: CredentialPayload): RestRetailerClient => {
    const key = String(tenantId);
    const existing = clients.get(key);
    if (existing) return existing;
    const client = options.buildClient(credential);
    clients.set(key, client);
    return client;
  };

  registry
    .register({
      kind: "catalogue",
      adapter: REST_ADAPTER,
      build: (ctx) => createRestCatalogueConnector(ensureClient(ctx.tenant.id, ctx.credential)),
    })
    .register({
      kind: "delivery",
      adapter: REST_ADAPTER,
      build: (ctx) => createRestDeliveryConnector(ensureClient(ctx.tenant.id, ctx.credential)),
    })
    .register({
      kind: "checkout",
      adapter: REST_ADAPTER,
      build: (ctx) => createRestCheckoutConnector(ensureClient(ctx.tenant.id, ctx.credential)),
    });

  return {
    getClient: (tenantId) => clients.get(String(tenantId)),
    evict: (tenantId) => {
      clients.delete(String(tenantId));
    },
  };
}

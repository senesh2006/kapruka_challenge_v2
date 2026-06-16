import { describe, expect, it, vi } from "vitest";
import { TenantSchema, type Tenant } from "@sevana/shared";
import {
  ConnectorRegistry,
  type CredentialResolver,
  KAPRUKA_TOOL_NAMES,
  KaprukaOutageError,
  KaprukaTransport,
  type McpClient,
  createKaprukaCatalogueConnector,
  createKaprukaCheckoutConnector,
  createKaprukaDeliveryConnector,
  registerKaprukaAdapter,
} from "../src/index.js";

// ---------- virtual clock ----------

class VirtualClock {
  private current = 0;
  private timers: Array<{ at: number; resolve: () => void }> = [];

  now(): number {
    return this.current;
  }

  sleep(ms: number): Promise<void> {
    return new Promise<void>((resolve) => {
      this.timers.push({ at: this.current + ms, resolve });
    });
  }

  async advance(ms: number): Promise<void> {
    const target = this.current + ms;
    while (true) {
      // Let any pending microtasks register new timers before we look.
      await flush();
      const due = this.timers
        .filter((t) => t.at <= target)
        .sort((a, b) => a.at - b.at);
      const next = due[0];
      if (!next) {
        this.current = target;
        break;
      }
      this.current = next.at;
      this.timers = this.timers.filter((t) => t !== next);
      next.resolve();
    }
  }
}

async function flush(rounds = 8): Promise<void> {
  for (let i = 0; i < rounds; i++) await Promise.resolve();
}

// ---------- shared fixtures ----------

const now = "2026-06-05T10:00:00.000Z";

function fakeClient(responses: Record<string, unknown | ((args: any) => unknown)>) {
  const calls: Array<{ name: string; args: unknown; at: number }> = [];
  const clock = { current: 0 };
  const client: McpClient = {
    callTool: vi.fn(async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args, at: clock.current });
      if (!(name in responses)) {
        throw new Error(`unexpected tool call: ${name}`);
      }
      const v = responses[name];
      // Unwrap 'params' if present before passing to the response handler
      const unwrappedArgs = (args && typeof args === 'object' && 'params' in args) ? args.params : args;
      return typeof v === "function" ? (v as (a: unknown) => unknown)(unwrappedArgs) : v;
    }),
  };
  return { client, calls };
}

function kaprukaProduct(id: string) {
  return {
    product_id: id,
    name: `Product ${id}`,
    thumbnail: "https://img.example.com/p.jpg",
    price_lkr: 5500,
    category_ids: ["flowers"],
    in_stock: true,
  };
}

function buildKaprukaTenant(): Tenant {
  return TenantSchema.parse({
    id: "kapruka",
    name: "Kapruka",
    enabledChannels: ["full-page"],
    persona: { brandVoice: "warm", languages: ["en"] },
    merchandising: {},
    guardrails: {},
    connectors: [
      { kind: "catalogue", adapter: "kapruka", credentialRef: "kap-prod" },
      { kind: "delivery", adapter: "kapruka", credentialRef: "kap-prod" },
      { kind: "checkout", adapter: "kapruka", credentialRef: "kap-prod" },
    ],
    credentials: [{ ref: "kap-prod", connectorKind: "catalogue", scopes: [] }],
    createdAt: now,
    updatedAt: now,
  });
}

// ===========================================================================

describe("Kapruka catalogue connector", () => {
  it("normalises searchProducts onto canonical shape", async () => {
    const { client } = fakeClient({
      kapruka_search_products: {
        results: [kaprukaProduct("p-1"), kaprukaProduct("p-2")],
        next_cursor: "page-2",
      },
    });
    const transport = new KaprukaTransport({ client });
    const cat = createKaprukaCatalogueConnector(transport);

    const result = await cat.searchProducts({ query: "roses", limit: 10 });
    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toMatchObject({
      id: "p-1",
      title: "Product p-1",
      price: { amount: 5500, currency: "LKR" },
    });
    expect(result.cursor).toBe("page-2");
  });

  it("returns an explicit empty result when MCP returns nothing", async () => {
    const { client } = fakeClient({ kapruka_search_products: null });
    const transport = new KaprukaTransport({ client });
    const cat = createKaprukaCatalogueConnector(transport);

    const result = await cat.searchProducts({ query: "missing", limit: 5 });
    expect(result).toEqual({ items: [] });
  });

  it("getProduct returns null when MCP returns nothing", async () => {
    const { client } = fakeClient({ kapruka_get_product: null });
    const transport = new KaprukaTransport({ client });
    const cat = createKaprukaCatalogueConnector(transport);

    expect(await cat.getProduct("missing" as never)).toBeNull();
  });

  it("listCategories returns [] when MCP returns nothing", async () => {
    const { client } = fakeClient({ kapruka_list_categories: null });
    const transport = new KaprukaTransport({ client });
    const cat = createKaprukaCatalogueConnector(transport);

    expect(await cat.listCategories()).toEqual([]);
  });

  it("caches catalogue reads under the short TTL", async () => {
    const vc = new VirtualClock();
    const { client } = fakeClient({
      kapruka_search_products: { results: [kaprukaProduct("p-1")] },
    });
    const transport = new KaprukaTransport({
      client,
      clock: vc,
      cache: { searchTtlMs: 60_000 },
    });
    const cat = createKaprukaCatalogueConnector(transport);

    await cat.searchProducts({ query: "roses", limit: 5 });
    await cat.searchProducts({ query: "roses", limit: 5 });
    expect(client.callTool).toHaveBeenCalledTimes(1);

    await vc.advance(60_001);
    await cat.searchProducts({ query: "roses", limit: 5 });
    expect(client.callTool).toHaveBeenCalledTimes(2);
  });

  it("getProduct caches by id under the product TTL", async () => {
    const vc = new VirtualClock();
    const { client } = fakeClient({
      kapruka_get_product: (args) => kaprukaProduct((args as { product_id: string }).product_id),
    });
    const transport = new KaprukaTransport({ client, clock: vc });
    const cat = createKaprukaCatalogueConnector(transport);

    await cat.getProduct("p-1" as never);
    await cat.getProduct("p-1" as never);
    await cat.getProduct("p-2" as never);
    expect(client.callTool).toHaveBeenCalledTimes(2);
  });
});

describe("Kapruka delivery connector", () => {
  it("does not cache checkDelivery (time/inventory sensitive)", async () => {
    const { client } = fakeClient({
      kapruka_check_delivery: { available: true, perishable_warnings: [] },
    });
    const transport = new KaprukaTransport({ client });
    const delivery = createKaprukaDeliveryConnector(transport);

    await delivery.checkDelivery("kandy", "2026-06-10T00:00:00.000Z", []);
    await delivery.checkDelivery("kandy", "2026-06-10T00:00:00.000Z", []);
    expect(client.callTool).toHaveBeenCalledTimes(2);
  });

  it("returns an explicit unavailable quote when MCP returns nothing", async () => {
    const { client } = fakeClient({ kapruka_check_delivery: null });
    const transport = new KaprukaTransport({ client });
    const delivery = createKaprukaDeliveryConnector(transport);

    const quote = await delivery.checkDelivery("kandy", "2026-06-10T00:00:00.000Z", []);
    expect(quote.available).toBe(false);
    expect(quote.reason).toBeDefined();
  });
});

describe("Kapruka checkout connector", () => {
  it("createOrder returns the retailer pay link", async () => {
    const { client } = fakeClient({
      kapruka_create_order: {
        order_ref: "KAP-12345",
        pay_link: "https://pay.kapruka.com/order/KAP-12345",
        total: 7500,
        currency: "LKR",
      },
    });
    const transport = new KaprukaTransport({ client });
    const checkout = createKaprukaCheckoutConnector(transport);

    const result = await checkout.createOrder({} as never);
    expect(result.retailerOrderRef).toBe("KAP-12345");
    expect(result.payLink).toBe("https://pay.kapruka.com/order/KAP-12345");
    expect(result.expectedTotal).toEqual({ amount: 7500, currency: "LKR" });
  });
});

describe("Kapruka rate limiting", () => {
  it("enforces 60 requests per minute per credential (using perMinute=2 for speed)", async () => {
    const vc = new VirtualClock();
    const { client } = fakeClient({ kapruka_get_product: null });
    const transport = new KaprukaTransport({
      client,
      clock: vc,
      rateLimit: { perMinute: 2, orderCreationsPerHour: 9999 },
    });

    const p1 = transport.call(KAPRUKA_TOOL_NAMES.catalogue.get, { product_id: "a" });
    const p2 = transport.call(KAPRUKA_TOOL_NAMES.catalogue.get, { product_id: "b" });
    const p3 = transport.call(KAPRUKA_TOOL_NAMES.catalogue.get, { product_id: "c" });

    await flush();
    expect(client.callTool).toHaveBeenCalledTimes(2);

    await vc.advance(60_001);
    await Promise.all([p1, p2, p3]);
    expect(client.callTool).toHaveBeenCalledTimes(3);
  });

  it("enforces 30 order-creations per hour separately from the per-minute global", async () => {
    const vc = new VirtualClock();
    const orderResponse = {
      order_ref: "KAP-1",
      pay_link: "https://pay.kapruka.com/x",
      total: 1,
      currency: "LKR",
    };
    const { client } = fakeClient({ kapruka_create_order: orderResponse });
    const transport = new KaprukaTransport({
      client,
      clock: vc,
      rateLimit: { perMinute: 9999, orderCreationsPerHour: 2 },
    });

    const p1 = transport.call(KAPRUKA_TOOL_NAMES.checkout.createOrder, {});
    const p2 = transport.call(KAPRUKA_TOOL_NAMES.checkout.createOrder, {});
    const p3 = transport.call(KAPRUKA_TOOL_NAMES.checkout.createOrder, {});

    await flush();
    expect(client.callTool).toHaveBeenCalledTimes(2);

    await vc.advance(3_600_001);
    await Promise.all([p1, p2, p3]);
    expect(client.callTool).toHaveBeenCalledTimes(3);
  });

  it("non-order calls are NOT counted against the hourly order limit", async () => {
    const vc = new VirtualClock();
    const { client } = fakeClient({ kapruka_get_product: null });
    const transport = new KaprukaTransport({
      client,
      clock: vc,
      rateLimit: { perMinute: 9999, orderCreationsPerHour: 1 },
    });

    await transport.call(KAPRUKA_TOOL_NAMES.catalogue.get, { product_id: "a" });
    await transport.call(KAPRUKA_TOOL_NAMES.catalogue.get, { product_id: "b" });
    await transport.call(KAPRUKA_TOOL_NAMES.catalogue.get, { product_id: "c" });

    expect(client.callTool).toHaveBeenCalledTimes(3);
  });
});

describe("Kapruka exponential backoff", () => {
  it("retries transient failures and succeeds, leaving only the successful call on the client", async () => {
    const vc = new VirtualClock();
    const { client } = fakeClient({ kapruka_get_product: null });
    const transport = new KaprukaTransport({
      client,
      clock: vc,
      retry: { maxAttempts: 4, baseDelayMs: 10, maxDelayMs: 1000 },
    });
    transport.fault.setFailNext(2);

    const p = transport.call(KAPRUKA_TOOL_NAMES.catalogue.get, { product_id: "x" });
    await vc.advance(2_000);
    await p;

    expect(client.callTool).toHaveBeenCalledTimes(1);
  });

  it("gives up after maxAttempts", async () => {
    const vc = new VirtualClock();
    const { client } = fakeClient({ kapruka_get_product: null });
    const transport = new KaprukaTransport({
      client,
      clock: vc,
      retry: { maxAttempts: 2, baseDelayMs: 5, maxDelayMs: 50 },
    });
    transport.fault.setFailNext(5);

    const p = transport.call(KAPRUKA_TOOL_NAMES.catalogue.get, { product_id: "x" });
    await vc.advance(1_000);
    await expect(p).rejects.toThrow(/transient/i);
    expect(client.callTool).not.toHaveBeenCalled();
  });
});

describe("Kapruka fault injection — simulated outage", () => {
  it("outage mode throws KaprukaOutageError without calling the client", async () => {
    const { client } = fakeClient({ kapruka_get_product: null });
    const transport = new KaprukaTransport({
      client,
      faultInjection: { outage: true },
    });

    await expect(
      transport.call(KAPRUKA_TOOL_NAMES.catalogue.get, { product_id: "x" }),
    ).rejects.toBeInstanceOf(KaprukaOutageError);
    expect(client.callTool).not.toHaveBeenCalled();
  });

  it("outage can be toggled on and off at runtime", async () => {
    const { client } = fakeClient({ kapruka_get_product: null });
    const transport = new KaprukaTransport({ client });
    const cat = createKaprukaCatalogueConnector(transport);

    expect(await cat.getProduct("x" as never)).toBeNull();
    transport.fault.setOutage(true);
    await expect(cat.getProduct("y" as never)).rejects.toBeInstanceOf(KaprukaOutageError);
    transport.fault.setOutage(false);
    expect(await cat.getProduct("z" as never)).toBeNull();
  });

  it("outage does not consume rate-limit quota", async () => {
    const vc = new VirtualClock();
    const { client } = fakeClient({ kapruka_get_product: null });
    const transport = new KaprukaTransport({
      client,
      clock: vc,
      rateLimit: { perMinute: 1, orderCreationsPerHour: 9999 },
      faultInjection: { outage: true },
    });

    for (let i = 0; i < 5; i++) {
      await expect(transport.call(KAPRUKA_TOOL_NAMES.catalogue.get, { product_id: String(i) })).rejects.toBeInstanceOf(
        KaprukaOutageError,
      );
    }

    transport.fault.setOutage(false);
    expect(await transport.call(KAPRUKA_TOOL_NAMES.catalogue.get, { product_id: "ok" })).toBeNull();
  });
});

describe("Kapruka credential isolation", () => {
  it("no credential value appears on any object reachable from a channel", async () => {
    const SECRET = "DO_NOT_LEAK_8675309";
    const credential = { apiKey: SECRET };

    const registry = new ConnectorRegistry();
    registerKaprukaAdapter(registry, {
      buildClient: (_cred) => ({
        // Credential is closed over here; not stored on the returned object.
        callTool: async () => null,
      }),
    });

    const resolver: CredentialResolver = { resolve: async () => credential };
    const retailer = await registry.resolve(buildKaprukaTenant(), {
      credentialResolver: resolver,
    });

    // Channel adapters only get the RetailerConnector — serialize it and
    // confirm the secret isn't leaked.
    const channelView = {
      catalogue: retailer.catalogue,
      delivery: retailer.delivery,
      checkout: retailer.checkout,
    };
    expect(JSON.stringify(channelView)).not.toContain(SECRET);
  });
});

describe("registerKaprukaAdapter", () => {
  it("registers all three capabilities and shares one transport per tenant", async () => {
    const buildClient = vi.fn((_cred) => ({ callTool: async () => null }));
    const registry = new ConnectorRegistry();
    const handle = registerKaprukaAdapter(registry, { buildClient });
    const resolver: CredentialResolver = {
      resolve: async () => ({ apiKey: "k" }),
    };

    const retailer = await registry.resolve(buildKaprukaTenant(), {
      credentialResolver: resolver,
    });
    expect(retailer.catalogue.adapter).toBe("kapruka");
    expect(retailer.delivery.adapter).toBe("kapruka");
    expect(retailer.checkout.adapter).toBe("kapruka");
    // One client built per tenant, not per capability.
    expect(buildClient).toHaveBeenCalledTimes(1);
    expect(handle.getTransport("kapruka" as never)).toBeDefined();
  });
});

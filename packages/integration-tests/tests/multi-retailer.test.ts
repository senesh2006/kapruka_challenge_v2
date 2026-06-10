/**
 * PRD §12.2 — Multi-retailer generalisation.
 *
 * Proves the platform, not a one-off bot:
 *  - A second retailer is implemented REST-based (not MCP) against the SAME
 *    connector contract, with no orchestrator changes.
 *  - The second tenant onboards entirely through config + credentials.
 *  - Both tenants run side by side with full isolation: no shared catalogue,
 *    persona, sessions, or events.
 */
import { describe, expect, it } from "vitest";
import {
  SessionSchema,
  TenantIdSchema,
  TenantSchema,
  TenantScope,
  type Session,
  type Tenant,
} from "@sevana/shared";
import {
  ConnectorRegistry,
  HttpMcpClient,
  RestRetailerClient,
  registerKaprukaAdapter,
  registerRestAdapter,
  type RetailerConnector,
} from "@sevana/connectors";
import {
  CatalogueShopperAgent,
  ConnectorLogisticsAgent,
  DefaultGuardrailAgent,
  Orchestrator,
  StubConciergeAgent,
  TenantRulesMerchandiserAgent,
} from "@sevana/orchestrator";
import {
  CustomerProfileRepository,
  EventRepository,
  InMemoryBlobAdapter,
  SessionRepository,
  StorageRetentionAgent,
  TenantRepository,
} from "@sevana/storage";
import { AnalyticsQueries, AnalyticsRecorder } from "@sevana/analytics";

const NOW = "2026-06-07T10:00:00.000Z";

// ---------------- tenant fixtures (pure config) ----------------

function kaprukaTenant(): Tenant {
  return TenantSchema.parse({
    id: "kapruka",
    name: "Kapruka",
    enabledChannels: ["full-page"],
    persona: { brandVoice: "Hari", languages: ["en", "si", "ta", "tanglish"] },
    merchandising: {},
    guardrails: {},
    connectors: [
      { kind: "catalogue", adapter: "kapruka", credentialRef: "kap-prod" },
      { kind: "delivery", adapter: "kapruka", credentialRef: "kap-prod" },
      { kind: "checkout", adapter: "kapruka", credentialRef: "kap-prod" },
    ],
    credentials: [{ ref: "kap-prod", connectorKind: "catalogue", scopes: [] }],
    createdAt: NOW,
    updatedAt: NOW,
  });
}

function velvetTenant(): Tenant {
  return TenantSchema.parse({
    id: "velvethome",
    name: "Velvet Home & Living",
    enabledChannels: ["widget"],
    persona: { brandVoice: "Vee", languages: ["en"] },
    merchandising: {},
    guardrails: {},
    connectors: [
      { kind: "catalogue", adapter: "rest", credentialRef: "velvet-prod" },
      { kind: "delivery", adapter: "rest", credentialRef: "velvet-prod" },
      { kind: "checkout", adapter: "rest", credentialRef: "velvet-prod" },
    ],
    credentials: [{ ref: "velvet-prod", connectorKind: "catalogue", scopes: [] }],
    createdAt: NOW,
    updatedAt: NOW,
  });
}

// ---------------- fake Kapruka MCP server ----------------

function fakeKaprukaMcpFetch(): typeof fetch {
  return (async (url: string | URL | Request) => {
    const u = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
    const tool = /\/tools\/([^/?]+)/.exec(u)?.[1] ?? "";
    const bodies: Record<string, unknown> = {
      kapruka_search_products: {
        results: [
          {
            product_id: "kap-cake-1",
            name: "Kiri-bath cake 500g",
            thumbnail: "https://img.kapruka.test/kiri-bath.jpg",
            price_lkr: 2400,
            category_ids: ["cake"],
            in_stock: true,
          },
        ],
      },
      kapruka_list_categories: [{ category_id: "cake", name: "Cakes" }],
      kapruka_list_delivery_cities: [{ city_id: "galle", name: "Galle" }],
      kapruka_check_delivery: { available: true, perishable_warnings: [] },
      kapruka_create_order: {
        order_ref: "KAP-1",
        pay_link: "https://pay.kapruka.test/1",
        total: 2400,
        currency: "LKR",
      },
      kapruka_track_order: { order_ref: "KAP-1", status: "paid", timeline: [] },
    };
    const body = bodies[tool];
    return new Response(JSON.stringify(body ?? { error: "unknown" }), {
      status: body ? 200 : 404,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

// ---------------- fake Velvet REST server (totally different wire) ----------------

function fakeVelvetRestFetch(): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    const u = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
    const { pathname } = new URL(u);
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

    if (pathname === "/categories") {
      return json([{ id: "throws", label: "Throws & Cushions" }]);
    }
    if (pathname === "/products") {
      return json({
        items: [
          {
            sku: "VLV-THROW-01",
            name: "Handloom cotton throw",
            image: "https://img.velvet.test/throw.jpg",
            price: { value: 49.5, currency: "usd" },
            categories: ["throws"],
            inStock: true,
          },
        ],
      });
    }
    if (pathname.startsWith("/products/")) {
      return json(
        {
          sku: "VLV-THROW-01",
          name: "Handloom cotton throw",
          image: "https://img.velvet.test/throw.jpg",
          price: { value: 49.5, currency: "usd" },
          categories: ["throws"],
          inStock: true,
          description: "Handwoven in Sri Lanka",
        },
      );
    }
    if (pathname === "/shipping/cities") {
      return json([{ code: "nyc", city: "New York", alsoKnownAs: ["NYC"] }]);
    }
    if (pathname === "/shipping/quote") {
      return json({ deliverable: true, earliest: "2026-06-12T00:00:00.000Z", warnings: [] });
    }
    if (pathname === "/orders" && init?.method === "POST") {
      return json({
        orderNumber: "VLV-9001",
        paymentUrl: "https://pay.velvet.test/VLV-9001",
        amount: { value: 49.5, currency: "usd" },
      });
    }
    if (pathname.startsWith("/orders/")) {
      return json({ orderNumber: "VLV-9001", state: "processing", history: [] });
    }
    return json({ error: "not found" }, 404);
  }) as unknown as typeof fetch;
}

// ---------------- shared registry: both adapters, one resolve path ----------------

function buildRegistry() {
  const registry = new ConnectorRegistry();
  registerKaprukaAdapter(registry, {
    buildClient: () =>
      new HttpMcpClient({ baseUrl: "https://mcp.kapruka.test", fetchImpl: fakeKaprukaMcpFetch() }),
  });
  registerRestAdapter(registry, {
    buildClient: (credential) =>
      new RestRetailerClient({
        baseUrl: String(credential.baseUrl ?? "https://api.velvet.test"),
        fetchImpl: fakeVelvetRestFetch(),
      }),
  });
  return registry;
}

function makeSession(tenantId: string, id: string, channel: "full-page" | "widget"): Session {
  return SessionSchema.parse({
    id,
    tenantId,
    channel,
    startedAt: NOW,
    lastTouchedAt: NOW,
  });
}

describe("PRD §12.2 — multi-retailer generalisation", () => {
  it("REST adapter satisfies the same contract: canonical shapes from a camelCase REST wire", async () => {
    const registry = buildRegistry();
    const connector = await registry.resolve(velvetTenant(), {
      credentialResolver: { resolve: async () => ({ baseUrl: "https://api.velvet.test" }) },
    });

    const cats = await connector.catalogue.listCategories();
    expect(cats).toEqual([{ id: "throws", name: "Throws & Cushions" }]);

    const search = await connector.catalogue.searchProducts({ query: "throw", limit: 5 });
    expect(search.items[0]).toMatchObject({
      title: "Handloom cotton throw",
      price: { amount: 49.5, currency: "USD" }, // lowercase "usd" normalised
    });

    const product = await connector.catalogue.getProduct("VLV-THROW-01" as never);
    expect(product?.description).toBe("Handwoven in Sri Lanka");

    const cities = await connector.delivery.listDeliveryCities();
    expect(cities[0]).toMatchObject({ name: "New York", aliases: ["NYC"] });

    const quote = await connector.delivery.checkDelivery("nyc", NOW, []);
    expect(quote.available).toBe(true);

    const confirmation = await connector.checkout.createOrder({} as never);
    expect(confirmation.payLink).toBe("https://pay.velvet.test/VLV-9001");
    expect(confirmation.expectedTotal).toEqual({ amount: 49.5, currency: "USD" });

    const tracking = await connector.checkout.trackOrder("VLV-9001");
    expect(tracking.currentStatus).toBe("processing");
  });

  it("both tenants run through the SAME orchestrator with zero code changes — each gets its own catalogue", async () => {
    const registry = buildRegistry();
    const connectorCache = new Map<string, RetailerConnector>();
    const connectorFor = async (tenant: Tenant): Promise<RetailerConnector> => {
      const key = String(tenant.id);
      const hit = connectorCache.get(key);
      if (hit) return hit;
      const resolved = await registry.resolve(tenant, {
        credentialResolver: { resolve: async () => ({ baseUrl: "https://api.velvet.test" }) },
      });
      connectorCache.set(key, resolved);
      return resolved;
    };

    const blob = new InMemoryBlobAdapter();
    const events = new EventRepository(blob);
    const recorder = new AnalyticsRecorder({ events });
    const orchestrator = new Orchestrator({
      agents: {
        concierge: new StubConciergeAgent(),
        shopper: new CatalogueShopperAgent(connectorFor),
        logistics: new ConnectorLogisticsAgent(connectorFor),
        merchandiser: new TenantRulesMerchandiserAgent(),
        retention: new StorageRetentionAgent(new CustomerProfileRepository(blob)),
        guardrail: new DefaultGuardrailAgent(),
      },
      connectorFor,
      maxRounds: 1,
    });
    recorder.attachToOrchestrator(orchestrator);

    const kapTurn = await orchestrator.handleTurn({
      session: makeSession("kapruka", "sess-kap", "full-page"),
      tenant: kaprukaTenant(),
      customerMessage: "Birthday cake",
    });
    const velvetTurn = await orchestrator.handleTurn({
      session: makeSession("velvethome", "sess-vlv", "widget"),
      tenant: velvetTenant(),
      customerMessage: "A cosy throw",
    });

    // Each tenant sees ONLY its own catalogue — no bleed in either direction.
    expect(kapTurn.cardRefs).toEqual(["kap-cake-1"]);
    expect(velvetTurn.cardRefs).toEqual(["VLV-THROW-01"]);
    expect(kapTurn.reply).not.toContain("Handloom");
    expect(velvetTurn.reply).not.toContain("Kiri-bath");

    // Personas stay per-tenant: the stub concierge voices the tenant's own brand.
    expect(kapTurn.reply).toContain("Hari");
    expect(velvetTurn.reply).toContain("Vee");

    // Analytics isolation: each tenant's summary contains only its own session.
    await new Promise((r) => setImmediate(r));
    const queries = new AnalyticsQueries(events);
    const kapSummary = await queries.summary(TenantIdSchema.parse("kapruka"));
    const velvetSummary = await queries.summary(TenantIdSchema.parse("velvethome"));
    expect(kapSummary.funnel.sessions).toBe(1);
    expect(velvetSummary.funnel.sessions).toBe(1);
    expect(kapSummary.channelMix[0]?.channel).toBe("full-page");
    expect(velvetSummary.channelMix[0]?.channel).toBe("widget");
  });

  it("the second tenant onboards entirely through config — provision, store, resolve, no code", async () => {
    const blob = new InMemoryBlobAdapter();
    const tenants = new TenantRepository(blob);

    // Provision purely via repository write (what POST /api/tenants does).
    await tenants.put(kaprukaTenant());
    await tenants.put(velvetTenant());

    const stored = await tenants.get(TenantIdSchema.parse("velvethome"));
    expect(stored?.persona.brandVoice).toBe("Vee");
    expect(stored?.connectors.every((c) => c.adapter === "rest")).toBe(true);

    // The stored config resolves straight through the registry.
    const registry = buildRegistry();
    const connector = await registry.resolve(stored!, {
      credentialResolver: { resolve: async () => ({ baseUrl: "https://api.velvet.test" }) },
    });
    expect(connector.catalogue.adapter).toBe("rest");
    expect(connector.tenantId).toBe(stored!.id);
  });

  it("storage isolation holds with both tenants active: sessions are invisible across scopes", async () => {
    const blob = new InMemoryBlobAdapter();
    const sessions = new SessionRepository(blob);
    const kapScope = new TenantScope(TenantIdSchema.parse("kapruka"));
    const velvetScope = new TenantScope(TenantIdSchema.parse("velvethome"));

    await sessions.upsert(makeSession("kapruka", "sess-1", "full-page"), kapScope);
    await sessions.upsert(makeSession("velvethome", "sess-1", "widget"), velvetScope);

    // Same logical session id, two tenants, zero collision.
    const kapList = await sessions.list(kapScope);
    const velvetList = await sessions.list(velvetScope);
    expect(kapList).toHaveLength(1);
    expect(velvetList).toHaveLength(1);
    expect(kapList[0]?.channel).toBe("full-page");
    expect(velvetList[0]?.channel).toBe("widget");
  });
});

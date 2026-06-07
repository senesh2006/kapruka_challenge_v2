import { describe, expect, it, vi } from "vitest";
import { SessionSchema, TenantSchema, type Session, type Tenant } from "@sevana/shared";
import type { RetailerConnector } from "@sevana/connectors";
import {
  CatalogueShopperAgent,
  ConnectorLogisticsAgent,
  DefaultGuardrailAgent,
  InMemoryRetentionAgent,
  ORCHESTRATOR_PACKAGE,
  Orchestrator,
  StageEmitter,
  StubConciergeAgent,
  TenantRulesMerchandiserAgent,
  type StageEvent,
} from "../src/index.js";

const NOW = "2026-06-07T10:00:00.000Z";

function tenant(): Tenant {
  return TenantSchema.parse({
    id: "kapruka",
    name: "Kapruka",
    enabledChannels: ["full-page"],
    persona: { brandVoice: "Hari", languages: ["en", "si", "tanglish"] },
    merchandising: { rankingPriorities: ["in-stock-first"] },
    guardrails: {},
    connectors: [
      { kind: "catalogue", adapter: "kapruka", credentialRef: "k" },
      { kind: "delivery", adapter: "kapruka", credentialRef: "k" },
      { kind: "checkout", adapter: "kapruka", credentialRef: "k" },
    ],
    credentials: [{ ref: "k", connectorKind: "catalogue", scopes: [] }],
    createdAt: NOW,
    updatedAt: NOW,
  });
}

function session(): Session {
  return SessionSchema.parse({
    id: "sess-1",
    tenantId: "kapruka",
    channel: "full-page",
    startedAt: NOW,
    lastTouchedAt: NOW,
  });
}

interface StubConnectorOpts {
  searchResults?: Array<{ id: string; title: string; price: number }>;
  deliveryAvailable?: boolean;
}

function stubConnector(opts: StubConnectorOpts = {}): RetailerConnector {
  const results = opts.searchResults ?? [
    { id: "kap-cake-1", title: "Kiri-bath cake 500g", price: 2400 },
    { id: "kap-flowers-1", title: "Sunflower bouquet", price: 3000 },
  ];
  return {
    tenantId: "kapruka" as never,
    catalogue: {
      kind: "catalogue",
      adapter: "stub",
      searchProducts: async () => ({
        items: results.map((r) => ({
          id: r.id as never,
          title: r.title,
          imageUrl: "https://img.example.com/x.jpg",
          price: { amount: r.price, currency: "LKR" as never },
          categoryIds: [],
          available: true,
        })),
      }),
      getProduct: async () => null,
      listCategories: async () => [],
    },
    delivery: {
      kind: "delivery",
      adapter: "stub",
      listDeliveryCities: async () => [],
      checkDelivery: async () => ({
        available: opts.deliveryAvailable ?? true,
        earliestDate: "2026-06-10T00:00:00.000Z",
        perishableWarnings: ["Cake is perishable — same-day or next-morning only"],
      }),
    },
    checkout: {
      kind: "checkout",
      adapter: "stub",
      createOrder: async () => ({
        retailerOrderRef: "KAP-ORDER-1",
        payLink: "https://pay.kapruka.com/order/KAP-ORDER-1",
        currency: "LKR" as never,
        expectedTotal: { amount: 5400, currency: "LKR" as never },
      }),
      trackOrder: async () => ({
        retailerOrderRef: "KAP-ORDER-1",
        currentStatus: "paid",
        timeline: [],
      }),
    },
    crm: undefined,
  };
}

function makeOrchestrator(connector: RetailerConnector) {
  const connectorFor = async () => connector;
  return new Orchestrator({
    agents: {
      concierge: new StubConciergeAgent(),
      shopper: new CatalogueShopperAgent(connectorFor),
      logistics: new ConnectorLogisticsAgent(connectorFor),
      merchandiser: new TenantRulesMerchandiserAgent(),
      retention: new InMemoryRetentionAgent(),
      guardrail: new DefaultGuardrailAgent(),
    },
    connectorFor,
    maxRounds: 3,
  });
}

describe("package marker", () => {
  it("exposes its name", () => {
    expect(ORCHESTRATOR_PACKAGE).toBe("@sevana/orchestrator");
  });
});

describe("Orchestrator.handleTurn — end-to-end with stub agents", () => {
  it("drives the multi-agent loop and returns a grounded reply", async () => {
    const o = makeOrchestrator(stubConnector());
    const events: StageEvent[] = [];
    o.on((e) => events.push(e));

    const result = await o.handleTurn({
      session: session(),
      tenant: tenant(),
      customerMessage: "Birthday cake and flowers for my mother in Galle",
    });

    expect(result.guardrailVerdict).toBe("approved");
    expect(result.reply).toContain("Kiri-bath cake");
    expect(result.cardRefs).toContain("kap-cake-1");
    expect(result.plan.candidatesBySlot["primary"]?.length).toBeGreaterThan(0);

    // Stage events fire for every step of the loop.
    const kinds = events.map((e) => e.kind);
    expect(kinds).toContain("turn.start");
    expect(kinds).toContain("retention.load");
    expect(kinds).toContain("concierge.read");
    expect(kinds).toContain("shopper.curate");
    expect(kinds).toContain("merchandiser.apply");
    expect(kinds).toContain("logistics.assess");
    expect(kinds).toContain("guardrail.plan");
    expect(kinds).toContain("guardrail.reply");
    expect(kinds).toContain("concierge.present");
    expect(kinds).toContain("turn.end");
  });

  it("respects the loop round cap (NFR-3) when the brief can't be satisfied", async () => {
    // Empty catalogue → critic never converges; loop must cap.
    const o = makeOrchestrator(stubConnector({ searchResults: [] }));
    const events: StageEvent[] = [];
    o.on((e) => events.push(e));

    await o.handleTurn({
      session: session(),
      tenant: tenant(),
      customerMessage: "Find me something nobody has",
    });

    const capEvent = events.find((e) => e.kind === "loop.cap-reached");
    expect(capEvent).toBeDefined();
    // Shopper should also have emitted a demand-signal for analytics.
    expect(events.some((e) => e.kind === "shopper.demand-signal")).toBe(true);
  });

  it("blocks a reply with pressure phrasing via the guardrail", async () => {
    const o = makeOrchestrator(stubConnector());
    // Inject a Concierge that returns pressure text.
    (o as unknown as { agents: { concierge: { present: (i: unknown) => Promise<unknown> } } }).agents.concierge.present =
      async () => ({ reply: "Hurry — only 1 left!", cardRefs: [] });

    const result = await o.handleTurn({
      session: session(),
      tenant: tenant(),
      customerMessage: "Birthday cake",
    });
    expect(result.guardrailVerdict).toBe("blocked");
    expect(result.reply).toContain("pressure");
  });
});

describe("Orchestrator.createOrder — explicit confirmation gate (FR-10)", () => {
  it("refuses to call createOrder without explicit confirmation when the tenant requires it", async () => {
    const o = makeOrchestrator(stubConnector());
    const t = tenant();
    await expect(
      o.createOrder({
        plan: { brief: { situation: "", detectedLocale: "en", slots: [] }, candidatesBySlot: {}, cart: [] },
        session: session(),
        tenant: t,
        orderContext: {} as never,
        explicitConfirmation: false,
      }),
    ).rejects.toThrow(/explicit confirmation/i);
  });

  it("creates the order and returns the retailer pay link on explicit confirmation", async () => {
    const o = makeOrchestrator(stubConnector());
    const result = await o.createOrder({
      plan: { brief: { situation: "", detectedLocale: "en", slots: [] }, candidatesBySlot: {}, cart: [] },
      session: session(),
      tenant: tenant(),
      orderContext: {} as never,
      explicitConfirmation: true,
    });
    expect(result.confirmation.payLink).toBe("https://pay.kapruka.com/order/KAP-ORDER-1");
    expect(result.confirmation.retailerOrderRef).toBe("KAP-ORDER-1");
  });
});

describe("StageEmitter resilience", () => {
  it("a throwing listener does not break others or the orchestrator", async () => {
    const emitter = new StageEmitter();
    const seen: string[] = [];
    emitter.on(() => {
      throw new Error("boom");
    });
    emitter.on((e) => seen.push(e.kind));
    emitter.emit({
      kind: "turn.start",
      tenantId: "kapruka" as never,
      sessionId: "sess-1" as never,
      at: 0,
    });
    expect(seen).toEqual(["turn.start"]);
  });
});

describe("DefaultGuardrailAgent.reviewPlan — factual grounding", () => {
  it("rejects a plan whose cart contains an item not in the candidates", async () => {
    const g = new DefaultGuardrailAgent();
    const verdict = await g.reviewPlan({
      plan: {
        brief: { situation: "", detectedLocale: "en", slots: [] },
        candidatesBySlot: { primary: [] },
        cart: [{ productId: "made-up-id" as never, quantity: 1, unitPrice: { amount: 1, currency: "LKR" as never } }],
      },
      tenant: tenant(),
    });
    expect(verdict.approve).toBe(false);
  });
});

// Suppress unused-var lint
void vi;

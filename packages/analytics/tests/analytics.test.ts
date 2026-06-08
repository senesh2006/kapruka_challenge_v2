import { describe, expect, it } from "vitest";
import {
  TenantIdSchema,
  TenantScope,
  type Event,
  type TenantId,
} from "@sevana/shared";
import {
  EventRepository,
  InMemoryBlobAdapter,
} from "@sevana/storage";
import {
  ANALYTICS_PACKAGE,
  AnalyticsQueries,
  AnalyticsRecorder,
} from "../src/index.js";
import {
  InMemoryEventBus,
  type EventBus,
} from "@sevana/connectors";
import {
  CatalogueShopperAgent,
  ConnectorLogisticsAgent,
  DefaultGuardrailAgent,
  InMemoryRetentionAgent,
  Orchestrator,
  StubConciergeAgent,
  TenantRulesMerchandiserAgent,
} from "@sevana/orchestrator";
import { SessionSchema, TenantSchema, type Session, type Tenant } from "@sevana/shared";
import type { RetailerConnector } from "@sevana/connectors";

const TENANT_ID: TenantId = TenantIdSchema.parse("kapruka");
const NOW = "2026-06-07T10:00:00.000Z";

function evt(over: Partial<Event> = {}): Event {
  return {
    kind: "conversation",
    id: "e-1",
    tenantId: TENANT_ID,
    sessionId: "s-1" as never,
    turnRole: "concierge",
    contentLength: 12,
    at: NOW,
    ...over,
  } as Event;
}

describe("package marker", () => {
  it("exposes its id", () => {
    expect(ANALYTICS_PACKAGE).toBe("@sevana/analytics");
  });
});

describe("AnalyticsQueries.summary", () => {
  it("aggregates an empty store into zeroed counts", async () => {
    const repo = new EventRepository(new InMemoryBlobAdapter());
    const summary = await new AnalyticsQueries(repo).summary(TENANT_ID);
    expect(summary.funnel).toEqual({
      sessions: 0,
      recommendations: 0,
      ordersCreated: 0,
      ordersPaid: 0,
      ordersDelivered: 0,
    });
    expect(summary.channelMix).toEqual([]);
    expect(summary.demandSignals).toEqual([]);
    expect(summary.paymentSuccessRate).toBeNull();
  });

  it("counts sessions distinctly, tallies channels, and computes shares", async () => {
    const repo = new EventRepository(new InMemoryBlobAdapter());
    const scope = new TenantScope(TENANT_ID);
    await repo.append(
      evt({ id: "a", sessionId: "s-1" as never, channel: "widget" }),
      scope,
    );
    await repo.append(
      evt({ id: "b", sessionId: "s-1" as never, channel: "widget" }),
      scope,
    );
    await repo.append(
      evt({ id: "c", sessionId: "s-2" as never, channel: "full-page" }),
      scope,
    );
    const summary = await new AnalyticsQueries(repo).summary(TENANT_ID);
    expect(summary.funnel.sessions).toBe(2);
    expect(summary.channelMix).toEqual([
      { channel: "widget", conversations: 2, share: 2 / 3 },
      { channel: "full-page", conversations: 1, share: 1 / 3 },
    ]);
  });

  it("computes payment + fulfilment success rates", async () => {
    const repo = new EventRepository(new InMemoryBlobAdapter());
    const scope = new TenantScope(TENANT_ID);
    for (const status of ["succeeded", "succeeded", "failed"] as const) {
      await repo.append(
        {
          kind: "payment",
          id: `p-${status}-${Math.random()}`,
          tenantId: TENANT_ID,
          orderId: "KAP-1" as never,
          status,
          at: NOW,
        } as Event,
        scope,
      );
    }
    for (const status of ["delivered", "delivered", "delivered", "failed"] as const) {
      await repo.append(
        {
          kind: "fulfilment",
          id: `f-${status}-${Math.random()}`,
          tenantId: TENANT_ID,
          orderId: "KAP-1" as never,
          status,
          at: NOW,
        } as Event,
        scope,
      );
    }
    const summary = await new AnalyticsQueries(repo).summary(TENANT_ID);
    expect(summary.paymentSuccessRate).toBeCloseTo(2 / 3);
    expect(summary.fulfilmentSuccessRate).toBeCloseTo(3 / 4);
  });

  it("aggregates demand signals top-N by count", async () => {
    const repo = new EventRepository(new InMemoryBlobAdapter());
    const scope = new TenantScope(TENANT_ID);
    const reasons = [
      "halal cake galle",
      "halal cake galle",
      "halal cake galle",
      "same-day jaffna",
      "diabetic sweets",
    ];
    for (const reason of reasons) {
      await repo.append(
        {
          kind: "demand-signal",
          id: `d-${reason}-${Math.random()}`,
          tenantId: TENANT_ID,
          sessionId: "s-1" as never,
          reason,
          at: NOW,
        } as Event,
        scope,
      );
    }
    const summary = await new AnalyticsQueries(repo).summary(TENANT_ID);
    expect(summary.demandSignals).toEqual([
      { reason: "halal cake galle", count: 3 },
      { reason: "same-day jaffna", count: 1 },
      { reason: "diabetic sweets", count: 1 },
    ]);
  });

  it("respects a date range filter", async () => {
    const repo = new EventRepository(new InMemoryBlobAdapter());
    const scope = new TenantScope(TENANT_ID);
    await repo.append(evt({ id: "early", at: "2026-06-01T00:00:00.000Z" }), scope);
    await repo.append(evt({ id: "mid", at: "2026-06-07T00:00:00.000Z" }), scope);
    await repo.append(evt({ id: "late", at: "2026-06-14T00:00:00.000Z" }), scope);
    const queries = new AnalyticsQueries(repo);
    const summary = await queries.summary(TENANT_ID, {
      from: "2026-06-05T00:00:00.000Z",
      to: "2026-06-10T00:00:00.000Z",
    });
    expect(summary.totalEvents).toBe(1);
  });

  it("isolates per tenant — querying tenant A never sees tenant B's events", async () => {
    const repo = new EventRepository(new InMemoryBlobAdapter());
    const tA = TenantIdSchema.parse("kapruka");
    const tB = TenantIdSchema.parse("acme");
    await repo.append(evt({ id: "a", tenantId: tA }), new TenantScope(tA));
    await repo.append(evt({ id: "b", tenantId: tB }), new TenantScope(tB));
    const summary = await new AnalyticsQueries(repo).summary(tA);
    expect(summary.totalEvents).toBe(1);
  });
});

describe("AnalyticsRecorder — webhook bus → EventRepository", () => {
  it("subscribes to the event bus and persists every event", async () => {
    const repo = new EventRepository(new InMemoryBlobAdapter());
    const bus: EventBus = new InMemoryEventBus();
    const recorder = new AnalyticsRecorder({ events: repo });
    recorder.attachToBus(bus);

    await bus.publish({
      kind: "order",
      id: "ord-1",
      tenantId: TENANT_ID,
      sessionId: "s-1" as never,
      orderId: "KAP-1" as never,
      status: "created",
      at: NOW,
    });

    const summary = await new AnalyticsQueries(repo).summary(TENANT_ID);
    expect(summary.funnel.ordersCreated).toBe(1);
  });
});

describe("AnalyticsRecorder — orchestrator stage → Event translation", () => {
  function stubConnector(opts: { hasResults: boolean }): RetailerConnector {
    return {
      tenantId: "kapruka" as never,
      catalogue: {
        kind: "catalogue",
        adapter: "stub",
        searchProducts: async () => ({
          items: opts.hasResults
            ? [
                {
                  id: "kap-1" as never,
                  title: "Cake",
                  imageUrl: "https://img.example.com/c.jpg",
                  price: { amount: 2400, currency: "LKR" as never },
                  categoryIds: [],
                  available: true,
                },
              ]
            : [],
        }),
        getProduct: async () => null,
        listCategories: async () => [],
      },
      delivery: {
        kind: "delivery",
        adapter: "stub",
        listDeliveryCities: async () => [],
        checkDelivery: async () => ({ available: true, perishableWarnings: [] }),
      },
      checkout: {
        kind: "checkout",
        adapter: "stub",
        createOrder: async () => ({
          retailerOrderRef: "KAP-X",
          payLink: "https://pay.kapruka.com/x",
          currency: "LKR" as never,
          expectedTotal: { amount: 2400, currency: "LKR" as never },
        }),
        trackOrder: async () => ({
          retailerOrderRef: "KAP-X",
          currentStatus: "paid",
          timeline: [],
        }),
      },
      crm: undefined,
    };
  }

  function buildTenant(): Tenant {
    return TenantSchema.parse({
      id: "kapruka",
      name: "Kapruka",
      enabledChannels: ["full-page"],
      persona: { brandVoice: "Hari", languages: ["en"] },
      merchandising: {},
      guardrails: {},
      connectors: [
        { kind: "catalogue", adapter: "stub", credentialRef: "k" },
        { kind: "delivery", adapter: "stub", credentialRef: "k" },
        { kind: "checkout", adapter: "stub", credentialRef: "k" },
      ],
      credentials: [{ ref: "k", connectorKind: "catalogue", scopes: [] }],
      createdAt: NOW,
      updatedAt: NOW,
    });
  }

  function buildSession(): Session {
    return SessionSchema.parse({
      id: "s-1",
      tenantId: "kapruka",
      channel: "full-page",
      startedAt: NOW,
      lastTouchedAt: NOW,
    });
  }

  function buildOrchestrator(connector: RetailerConnector): Orchestrator {
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
    });
  }

  it("records a ConversationEvent on turn.end", async () => {
    const repo = new EventRepository(new InMemoryBlobAdapter());
    const recorder = new AnalyticsRecorder({ events: repo });
    const o = buildOrchestrator(stubConnector({ hasResults: true }));
    recorder.attachToOrchestrator(o);

    await o.handleTurn({
      session: buildSession(),
      tenant: buildTenant(),
      customerMessage: "Birthday cake",
    });

    // Allow the swallowed-error promise chain to settle.
    await new Promise((r) => setImmediate(r));
    const summary = await new AnalyticsQueries(repo).summary(TENANT_ID);
    expect(summary.funnel.sessions).toBeGreaterThanOrEqual(1);
  });

  it("records a DemandSignalEvent when the Shopper fans out a catalogue gap", async () => {
    const repo = new EventRepository(new InMemoryBlobAdapter());
    const recorder = new AnalyticsRecorder({ events: repo });
    const o = buildOrchestrator(stubConnector({ hasResults: false }));
    recorder.attachToOrchestrator(o);

    await o.handleTurn({
      session: buildSession(),
      tenant: buildTenant(),
      customerMessage: "Find me something nobody has",
    });

    await new Promise((r) => setImmediate(r));
    const summary = await new AnalyticsQueries(repo).summary(TENANT_ID);
    expect(summary.demandSignals.length).toBeGreaterThan(0);
  });

  it("records an OrderEvent on createOrder approval", async () => {
    const repo = new EventRepository(new InMemoryBlobAdapter());
    const recorder = new AnalyticsRecorder({ events: repo });
    const o = buildOrchestrator(stubConnector({ hasResults: true }));
    recorder.attachToOrchestrator(o);

    await o.createOrder({
      plan: { brief: { situation: "", detectedLocale: "en", slots: [] }, candidatesBySlot: {}, cart: [] },
      session: buildSession(),
      tenant: buildTenant(),
      orderContext: {} as never,
      explicitConfirmation: true,
    });
    await new Promise((r) => setImmediate(r));
    const summary = await new AnalyticsQueries(repo).summary(TENANT_ID);
    expect(summary.funnel.ordersCreated).toBe(1);
  });
});

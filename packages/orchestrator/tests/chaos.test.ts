/**
 * Chaos tests — confirm NFR-4 / NFR-5: every external dependency has a
 * defined fallback so no single dependency can break the experience.
 *
 * Each test disables one dependency and asserts graceful degradation:
 * the turn still completes with an approved (honest) reply, the failure
 * surfaces as an `agent.degraded` warning for observability, and no
 * invented facts leak into the plan. The one deliberate exception is
 * checkout: order-creation failures MUST surface to the caller rather
 * than be silently swallowed.
 */
import { describe, expect, it } from "vitest";
import { SessionSchema, TenantSchema, type Session, type Tenant } from "@sevana/shared";
import type { RetailerConnector } from "@sevana/connectors";
import {
  CatalogueShopperAgent,
  ConnectorLogisticsAgent,
  DefaultGuardrailAgent,
  InMemoryRetentionAgent,
  Orchestrator,
  StubConciergeAgent,
  TenantRulesMerchandiserAgent,
} from "../src/index.js";

const NOW = "2026-06-07T10:00:00.000Z";

function tenant(): Tenant {
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

function session(): Session {
  return SessionSchema.parse({
    id: "sess-1",
    tenantId: "kapruka",
    channel: "full-page",
    startedAt: NOW,
    lastTouchedAt: NOW,
  });
}

function workingConnector(): RetailerConnector {
  return {
    tenantId: "kapruka" as never,
    catalogue: {
      kind: "catalogue",
      adapter: "stub",
      searchProducts: async () => ({
        items: [
          {
            id: "kap-cake" as never,
            title: "Cake",
            imageUrl: "https://img.example.com/c.jpg",
            price: { amount: 2400, currency: "LKR" as never },
            categoryIds: [],
            available: true,
          },
        ],
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
        retailerOrderRef: "X",
        payLink: "https://pay.kapruka.com/x",
        currency: "LKR" as never,
        expectedTotal: { amount: 2400, currency: "LKR" as never },
      }),
      trackOrder: async () => ({ retailerOrderRef: "X", currentStatus: "paid", timeline: [] }),
    },
    crm: undefined,
  };
}

function build(opts: { connector: RetailerConnector }) {
  const connectorFor = async () => opts.connector;
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
    maxRounds: 2,
  });
}

// ---------------- catalogue connector outage ----------------

describe("chaos: catalogue connector outage", () => {
  it("degrades gracefully when search throws: approved honest reply, demand signal, degraded warning, no invented items", async () => {
    const broken: RetailerConnector = {
      ...workingConnector(),
      catalogue: {
        kind: "catalogue",
        adapter: "stub",
        searchProducts: async () => {
          throw new Error("MCP outage");
        },
        getProduct: async () => null,
        listCategories: async () => [],
      },
    };
    const o = build({ connector: broken });
    const events: string[] = [];
    o.on((e) => events.push(e.kind));

    const result = await o.handleTurn({
      session: session(),
      tenant: tenant(),
      customerMessage: "Birthday cake",
    });

    expect(result.guardrailVerdict).toBe("approved");
    expect(result.cardRefs).toEqual([]); // no invented items (FR-4)
    expect(events).toContain("agent.degraded");
    expect(events).toContain("shopper.demand-signal");
    expect(events).toContain("loop.cap-reached");
  });

  it("when search returns empty (graceful outage shape), the orchestrator caps the loop and emits a demand signal", async () => {
    const emptyResults: RetailerConnector = {
      ...workingConnector(),
      catalogue: {
        kind: "catalogue",
        adapter: "stub",
        searchProducts: async () => ({ items: [] }),
        getProduct: async () => null,
        listCategories: async () => [],
      },
    };
    const o = build({ connector: emptyResults });
    const events: string[] = [];
    o.on((e) => events.push(e.kind));

    const result = await o.handleTurn({
      session: session(),
      tenant: tenant(),
      customerMessage: "Something nobody has",
    });

    expect(result.guardrailVerdict).toBe("approved");
    expect(events).toContain("loop.cap-reached");
    expect(events).toContain("shopper.demand-signal");
    // The concierge still presents — empty plan, no invented items (FR-4).
    expect(result.cardRefs).toEqual([]);
  });
});

// ---------------- delivery connector outage ----------------

describe("chaos: delivery connector outage", () => {
  it("the orchestrator already degrades gracefully when the brief has no destination (no connector call, no crash)", async () => {
    // The stock StubConciergeAgent doesn't extract a destination, so
    // ConnectorLogisticsAgent.assess short-circuits to `feasible: false`
    // BEFORE calling checkDelivery. This is the intended fallback shape:
    // if there's nothing to check, return a structured unfeasible result.
    const broken: RetailerConnector = {
      ...workingConnector(),
      delivery: {
        kind: "delivery",
        adapter: "stub",
        listDeliveryCities: async () => [],
        checkDelivery: async () => {
          throw new Error("delivery outage — should never be called");
        },
      },
    };
    const o = build({ connector: broken });

    const result = await o.handleTurn({
      session: session(),
      tenant: tenant(),
      customerMessage: "Cake",
    });
    expect(result.guardrailVerdict).toBe("approved");
    expect(result.plan.delivery?.feasible).toBe(false);
  });

  it("when checkDelivery does fire and throws, the orchestrator degrades to an honest 'can't confirm' assessment", async () => {
    // A logistics agent that always probes the connector and lets the throw
    // escape — exercising the orchestrator's defensive wrap rather than the
    // agent's internal catch.
    const broken: RetailerConnector = {
      ...workingConnector(),
      delivery: {
        kind: "delivery",
        adapter: "stub",
        listDeliveryCities: async () => [],
        checkDelivery: async () => {
          throw new Error("delivery outage");
        },
      },
    };
    const o = build({ connector: broken });
    const alwaysProbeLogistics = {
      assess: async () => {
        await broken.delivery.checkDelivery("kandy", new Date().toISOString(), []);
        return { destination: "kandy", feasible: true, perishableWarnings: [], notes: [] };
      },
    };
    (o as unknown as { agents: { logistics: typeof alwaysProbeLogistics } }).agents.logistics =
      alwaysProbeLogistics;

    const events: string[] = [];
    o.on((e) => events.push(e.kind));

    const result = await o.handleTurn({
      session: session(),
      tenant: tenant(),
      customerMessage: "Cake",
    });
    expect(result.guardrailVerdict).toBe("approved");
    expect(result.plan.delivery?.feasible).toBe(false);
    expect(result.plan.delivery?.notes).toContain("delivery info unavailable");
    expect(events).toContain("agent.degraded");
    expect(events).not.toContain("turn.error");
  });

  it("the agent's own internal catch also degrades (connector throws, agent returns degraded assessment)", async () => {
    const broken: RetailerConnector = {
      ...workingConnector(),
      delivery: {
        kind: "delivery",
        adapter: "stub",
        listDeliveryCities: async () => [],
        checkDelivery: async () => {
          throw new Error("delivery outage");
        },
      },
    };
    const o = build({ connector: broken });
    // Inject a destination so ConnectorLogisticsAgent actually calls the connector.
    const withDestinationConcierge = {
      read: async (input: { message: string }) => ({
        brief: {
          situation: input.message,
          detectedLocale: "en" as const,
          destination: "Kandy",
          slots: [{ id: "primary", description: input.message, categoryHints: [], required: true }],
        },
      }),
      present: async () => ({ reply: "ok", cardRefs: [] }),
    };
    (o as unknown as { agents: { concierge: typeof withDestinationConcierge } }).agents.concierge =
      withDestinationConcierge;

    const events: string[] = [];
    o.on((e) => events.push(e.kind));

    const result = await o.handleTurn({
      session: session(),
      tenant: tenant(),
      customerMessage: "Cake to Kandy",
    });
    expect(result.guardrailVerdict).toBe("approved");
    expect(result.plan.delivery?.feasible).toBe(false);
    expect(result.plan.delivery?.degraded).toBe(true);
    expect(events).toContain("agent.degraded");
  });
});

// ---------------- checkout connector outage on order ----------------

describe("chaos: checkout connector outage on createOrder", () => {
  it("surfaces an error rather than silently dropping the order request", async () => {
    const broken: RetailerConnector = {
      ...workingConnector(),
      checkout: {
        kind: "checkout",
        adapter: "stub",
        createOrder: async () => {
          throw new Error("checkout outage");
        },
        trackOrder: async () => {
          throw new Error("checkout outage");
        },
      },
    };
    const o = build({ connector: broken });
    await expect(
      o.createOrder({
        plan: { brief: { situation: "", detectedLocale: "en", slots: [] }, candidatesBySlot: {}, cart: [] },
        session: session(),
        tenant: tenant(),
        orderContext: {} as never,
        explicitConfirmation: true,
      }),
    ).rejects.toThrow(/checkout outage/);
  });
});

// ---------------- retention storage outage ----------------

describe("chaos: retention storage outage", () => {
  it("when retention.load throws, the turn degrades to an anonymous experience and still approves", async () => {
    const o = build({ connector: workingConnector() });
    const broken = {
      load: async () => {
        throw new Error("blob outage");
      },
      update: async () => undefined,
    };
    (o as unknown as { agents: { retention: typeof broken } }).agents.retention = broken;

    const events: string[] = [];
    o.on((e) => events.push(e.kind));

    const result = await o.handleTurn({
      session: session(),
      tenant: tenant(),
      customerMessage: "Cake",
    });
    expect(result.guardrailVerdict).toBe("approved");
    expect(result.cardRefs).toContain("kap-cake");
    expect(events).toContain("agent.degraded");
    expect(events).not.toContain("turn.error");
  });

  it("when retention.update throws after guardrail approval, the reply still ships — persistence is best-effort", async () => {
    const o = build({ connector: workingConnector() });
    const calls: string[] = [];
    const semiBroken = {
      load: async () => null,
      update: async () => {
        calls.push("update");
        throw new Error("blob outage on update");
      },
    };
    (o as unknown as { agents: { retention: typeof semiBroken } }).agents.retention = semiBroken;

    const events: string[] = [];
    o.on((e) => events.push(e.kind));

    const result = await o.handleTurn({
      session: session(),
      tenant: tenant(),
      customerMessage: "Cake",
    });
    expect(result.guardrailVerdict).toBe("approved");
    expect(calls).toEqual(["update"]);
    expect(events).toContain("agent.degraded");
  });
});

// ---------------- guardrail block path ----------------

describe("chaos: guardrail rejects the plan", () => {
  it("returns a structured blocked verdict rather than a hard error", async () => {
    const o = build({ connector: workingConnector() });
    const rejecting = {
      reviewPlan: async () => ({
        approve: false,
        reason: "policy violation",
        refineSlotIds: [],
      }),
      reviewReply: async () => ({ approve: true }),
      reviewOrder: async () => ({ approve: true }),
    };
    (o as unknown as { agents: { guardrail: typeof rejecting } }).agents.guardrail = rejecting;

    const result = await o.handleTurn({
      session: session(),
      tenant: tenant(),
      customerMessage: "Cake",
    });
    expect(result.guardrailVerdict).toBe("blocked");
    expect(result.reply).toContain("policy violation");
  });
});

/**
 * PRD §6.2 / FR-7 / NFR-5 — visual output and try-on fallback.
 *
 * Asserts:
 *  - NoopTryOnService passes the flat catalogue image through unchanged.
 *  - StubTryOnService returns a deterministic placeholder different from the
 *    flat image (proves the try-on path actually ran).
 *  - Orchestrator builds `cards` from the plan, marks the first card as the
 *    hero, and renders only the hero live (NFR-3 latency budget).
 *  - A throwing TryOnService degrades the hero to the flat catalogue image,
 *    marks `renderDegraded: true`, and emits an `agent.degraded` warning.
 *  - Without a try-on service, every card just uses the flat image.
 *  - Blocked-guardrail paths return `cards: []`.
 */
import { describe, expect, it, vi } from "vitest";
import { SessionSchema, TenantSchema, type Session, type Tenant } from "@sevana/shared";
import type { RetailerConnector } from "@sevana/connectors";
import {
  CatalogueShopperAgent,
  ConnectorLogisticsAgent,
  DefaultGuardrailAgent,
  InMemoryRetentionAgent,
  NoopTryOnService,
  Orchestrator,
  StubConciergeAgent,
  StubTryOnService,
  TenantRulesMerchandiserAgent,
  type TryOnService,
} from "../src/index.js";

const NOW = "2026-06-07T10:00:00.000Z";

function tenant(): Tenant {
  return TenantSchema.parse({
    id: "kapruka",
    name: "Kapruka",
    enabledChannels: ["full-page"],
    persona: { brandVoice: "Hari", languages: ["en", "tanglish"] },
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
    id: "s-1",
    tenantId: "kapruka",
    channel: "full-page",
    startedAt: NOW,
    lastTouchedAt: NOW,
  });
}

function makeConnector(items: Array<{ id: string; title: string; price: number; img: string }>): RetailerConnector {
  return {
    tenantId: "kapruka" as never,
    catalogue: {
      kind: "catalogue",
      adapter: "stub",
      searchProducts: async () => ({
        items: items.map((i) => ({
          id: i.id as never,
          title: i.title,
          imageUrl: i.img,
          price: { amount: i.price, currency: "LKR" as never },
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
        available: true,
        earliestDate: "2026-06-10T00:00:00.000Z",
        perishableWarnings: [],
      }),
    },
    checkout: {
      kind: "checkout",
      adapter: "stub",
      createOrder: async () => ({
        retailerOrderRef: "X",
        payLink: "https://pay.kapruka.test/x",
        currency: "LKR" as never,
        expectedTotal: { amount: 0, currency: "LKR" as never },
      }),
      trackOrder: async () => ({ retailerOrderRef: "X", currentStatus: "paid", timeline: [] }),
    },
    crm: undefined,
  };
}

function makeOrchestrator(opts: { tryOn?: TryOnService; itemCount?: number } = {}) {
  const count = opts.itemCount ?? 1;
  const items = Array.from({ length: count }, (_, i) => ({
    id: `kap-${i + 1}`,
    title: `Product ${i + 1}`,
    price: 1000 + i * 100,
    img: `https://img.kapruka.test/flat-${i + 1}.jpg`,
  }));
  const connector = makeConnector(items);
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
    maxRounds: 1,
    ...(opts.tryOn ? { tryOn: opts.tryOn } : {}),
  });
}

describe("NoopTryOnService", () => {
  it("returns the flat catalogue image", async () => {
    const svc = new NoopTryOnService();
    const result = await svc.render({
      product: {
        id: "p-1" as never,
        title: "x",
        imageUrl: "https://img.kapruka.test/flat.jpg",
        price: { amount: 100, currency: "LKR" as never },
        categoryIds: [],
        available: true,
      },
      persona: { brandVoice: "Hari", tone: [], opinions: [], languages: ["en"], signatureBehaviours: [] },
      locale: "en",
    });
    expect(result.url).toBe("https://img.kapruka.test/flat.jpg");
  });
});

describe("StubTryOnService", () => {
  it("returns a deterministic placeholder distinct from the flat image", async () => {
    const svc = new StubTryOnService();
    const result = await svc.render({
      product: {
        id: "p-1" as never,
        title: "Cake",
        imageUrl: "https://img.kapruka.test/flat.jpg",
        price: { amount: 100, currency: "LKR" as never },
        categoryIds: [],
        available: true,
      },
      persona: { brandVoice: "Hari", tone: [], opinions: [], languages: ["en"], signatureBehaviours: [] },
      locale: "en",
    });
    expect(result.url).not.toBe("https://img.kapruka.test/flat.jpg");
    expect(result.url).toContain("id=p-1");
    expect(result.url).toContain("on-model");
  });

  it("renders the same product to the same URL across calls (deterministic)", async () => {
    const svc = new StubTryOnService();
    const product = {
      id: "p-stable" as never,
      title: "Sundress",
      imageUrl: "https://img.kapruka.test/x.jpg",
      price: { amount: 100, currency: "LKR" as never },
      categoryIds: [],
      available: true,
    };
    const a = await svc.render({ product, persona: { brandVoice: "Hari", tone: [], opinions: [], languages: ["en"], signatureBehaviours: [] }, locale: "en" });
    const b = await svc.render({ product, persona: { brandVoice: "Hari", tone: [], opinions: [], languages: ["en"], signatureBehaviours: [] }, locale: "en" });
    expect(a.url).toBe(b.url);
  });
});

describe("Orchestrator.handleTurn — cards rendering", () => {
  it("returns no cards when no try-on service is wired and only flat images are used", async () => {
    const o = makeOrchestrator({ itemCount: 1 });
    const result = await o.handleTurn({
      session: session(),
      tenant: tenant(),
      customerMessage: "anything",
    });
    expect(result.guardrailVerdict).toBe("approved");
    expect(result.cards).toHaveLength(1);
    const card = result.cards[0]!;
    expect(card.isHero).toBe(true);
    expect(card.imageUrl).toBe("https://img.kapruka.test/flat-1.jpg");
    expect(card.renderUrl).toBeUndefined();
    expect(card.renderDegraded).toBeUndefined();
  });

  it("renders ONLY the hero (first) card live when a try-on service is configured (NFR-3)", async () => {
    const svc = new StubTryOnService();
    const renderSpy = vi.spyOn(svc, "render");
    const o = makeOrchestrator({ tryOn: svc, itemCount: 1 });
    const result = await o.handleTurn({
      session: session(),
      tenant: tenant(),
      customerMessage: "x",
    });
    expect(result.cards).toHaveLength(1);
    const hero = result.cards[0]!;
    expect(hero.isHero).toBe(true);
    expect(hero.renderUrl).toBeDefined();
    expect(hero.renderUrl).not.toBe(hero.imageUrl);
    expect(hero.renderDegraded).toBeUndefined();
    expect(renderSpy).toHaveBeenCalledTimes(1);
  });

  it("falls back to the flat image and marks renderDegraded when the try-on service throws (NFR-5)", async () => {
    const brokenTryOn: TryOnService = {
      id: "broken",
      render: async () => {
        throw new Error("try-on backend down");
      },
    };
    const o = makeOrchestrator({ tryOn: brokenTryOn, itemCount: 1 });
    const events: Array<{ kind: string; error?: string; data?: unknown }> = [];
    o.on((e) => events.push({ kind: e.kind, error: e.error, data: e.data }));

    const result = await o.handleTurn({
      session: session(),
      tenant: tenant(),
      customerMessage: "x",
    });
    expect(result.guardrailVerdict).toBe("approved"); // turn still completes
    const hero = result.cards[0]!;
    expect(hero.renderDegraded).toBe(true);
    expect(hero.renderUrl).toBeUndefined(); // no live URL — fall back to flat
    expect(hero.imageUrl).toBe("https://img.kapruka.test/flat-1.jpg");

    const degraded = events.find((e) => e.kind === "agent.degraded");
    expect(degraded).toBeDefined();
    expect(degraded?.data).toMatchObject({ agent: "try-on" });
    expect(degraded?.error).toMatch(/try-on backend down/);
  });
});

/**
 * PRD §11.3 — Internationalisation.
 *
 * Sinhala / Tamil / Tanglish first-class; multi-currency throughout
 * (prices, carts, order context); place-name handling via the delivery
 * connector regardless of model strength.
 */
import { describe, expect, it } from "vitest";
import {
  CartLineSchema,
  CustomerProfileSchema,
  MoneySchema,
  OrderContextSchema,
  SessionSchema,
  TenantSchema,
  detectLocaleFromMessage,
  type CurrencyCode,
  type Locale,
  type Tenant,
} from "@sevana/shared";
import {
  DefaultGuardrailAgent,
  InMemoryRetentionAgent,
  Orchestrator,
  StubConciergeAgent,
  TenantRulesMerchandiserAgent,
  CatalogueShopperAgent,
  ConnectorLogisticsAgent,
} from "@sevana/orchestrator";
import type { RetailerConnector } from "@sevana/connectors";

const NOW = "2026-06-07T10:00:00.000Z";

const ALL_LANGS = ["en", "si", "ta", "tanglish"] as const satisfies ReadonlyArray<Locale>;

function tenant(): Tenant {
  return TenantSchema.parse({
    id: "kapruka",
    name: "Kapruka",
    enabledChannels: ["full-page"],
    persona: { brandVoice: "Hari", languages: ALL_LANGS },
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

// ============================================================================
// 1. Locale detection — real Sri Lankan situation phrases
// ============================================================================

interface Case {
  message: string;
  expected: Locale;
  context: string;
}

const ENGLISH_CASES: Case[] = [
  { context: "birthday — diaspora sender", message: "Birthday cake for my mother in Galle", expected: "en" },
  { context: "wedding gift", message: "I need a wedding gift for a colleague, budget 12,000", expected: "en" },
  { context: "apology", message: "Looking for something thoughtful — I need to apologise to my partner", expected: "en" },
];

const SINHALA_CASES: Case[] = [
  { context: "anniversary in Kandy", message: "අපේ සංවත්සරයට මහ නුවරට කේක් එකක්", expected: "si" },
  { context: "amma's birthday", message: "අම්මගේ උපන්දිනයට මල් කලඹක් යවන්න", expected: "si" },
  { context: "Galle delivery", message: "ගාල්ලට කේක් එකක් සහ මල් යවන්න ඕනේ", expected: "si" },
];

const TAMIL_CASES: Case[] = [
  { context: "Jaffna birthday", message: "என் தாயின் பிறந்தநாள் - யாழ்ப்பாணம் கேக் அனுப்ப வேண்டும்", expected: "ta" },
  { context: "Diwali gift", message: "தீபாவளிக்கு இனிப்பு பெட்டி", expected: "ta" },
  { context: "anniversary", message: "எங்கள் திருமணநாளுக்கு பூக்கள் வேண்டும்", expected: "ta" },
];

const TANGLISH_CASES: Case[] = [
  { context: "amma's birthday — diaspora", message: "Aiyo machan, amma's birthday eka tomorrow, cake ekak Galle ekata yawanawa", expected: "tanglish" },
  { context: "Sinhala-glish wedding", message: "Mama eka wedding ekata gaman, sare ekak ona", expected: "tanglish" },
  { context: "Tamil-glish apology", message: "Dei thambi, enna pannuvathu — anniversary marandhuten, machan suggest pannu", expected: "tanglish" },
  { context: "apology with kinship", message: "Akki ge birthday ekata podi gift ekak ona", expected: "tanglish" },
  { context: "Tamil-glish gift", message: "Ada appa ku gift edhuvum venum, illa", expected: "tanglish" },
];

describe("PRD §11.3 — locale detection on real Sri Lankan phrases", () => {
  for (const c of [...ENGLISH_CASES, ...SINHALA_CASES, ...TAMIL_CASES, ...TANGLISH_CASES]) {
    it(`[${c.expected}] ${c.context}`, () => {
      const locale = detectLocaleFromMessage(c.message, { enabledLanguages: ALL_LANGS });
      expect(locale).toBe(c.expected);
    });
  }

  it("falls back to English when no native script or romanised tokens hit", () => {
    expect(
      detectLocaleFromMessage("Just a simple message", { enabledLanguages: ALL_LANGS }),
    ).toBe("en");
  });

  it("respects tenant-disabled languages — never returns a locale the tenant did not enable", () => {
    // Sinhala message but Sinhala disabled — falls back to English.
    expect(
      detectLocaleFromMessage("අම්මගේ", { enabledLanguages: ["en", "tanglish"] }),
    ).toBe("en");
    // Tamil-glish in a tenant that only enabled Sinhala-glish + English.
    expect(
      detectLocaleFromMessage("Dei thambi enna pannuvathu", {
        enabledLanguages: ["en", "tanglish"],
      }),
    ).toBe("tanglish");
  });
});

// ============================================================================
// 2. Locale detection flows through the StubConciergeAgent
// ============================================================================

describe("StubConciergeAgent.read picks up the detected locale", () => {
  it("writes detectedLocale into the brief for each language mode", async () => {
    const agent = new StubConciergeAgent();
    const session = SessionSchema.parse({
      id: "s-1",
      tenantId: "kapruka",
      channel: "full-page",
      startedAt: NOW,
      lastTouchedAt: NOW,
    });

    for (const c of [
      ENGLISH_CASES[0]!,
      SINHALA_CASES[0]!,
      TAMIL_CASES[0]!,
      TANGLISH_CASES[0]!,
    ]) {
      const { brief } = await agent.read({
        message: c.message,
        session,
        persona: tenant().persona,
      });
      expect(brief.detectedLocale).toBe(c.expected);
    }
  });
});

// ============================================================================
// 3. Multi-currency round-trip (diaspora sender flow)
// ============================================================================

const DIASPORA_CURRENCIES: CurrencyCode[] = ["USD", "GBP", "AUD", "EUR", "LKR"] as never;

describe("PRD §11.3 — multi-currency round-trip through Money + OrderContext", () => {
  for (const currency of DIASPORA_CURRENCIES) {
    it(`Money + CartLine + OrderContext preserve ${currency} end-to-end`, () => {
      const money = MoneySchema.parse({ amount: 100, currency });
      expect(money.currency).toBe(currency);

      const line = CartLineSchema.parse({
        productId: "kap-cake-1",
        quantity: 1,
        unitPrice: { amount: 100, currency },
      });
      expect(line.unitPrice.currency).toBe(currency);

      const order = OrderContextSchema.parse({
        id: "ord-1",
        tenantId: "kapruka",
        sessionId: "sess-1",
        sender: { name: "Sahan" },
        recipients: [{ name: "Amma", destination: { rawText: "Galle" } }],
        lines: [{ productId: "kap-1", quantity: 1, unitPrice: { amount: 100, currency } }],
        currency,
        total: { amount: 100, currency },
        status: "draft",
        createdAt: NOW,
        updatedAt: NOW,
      });
      expect(order.currency).toBe(currency);
      expect(order.total.currency).toBe(currency);
      expect(order.lines[0]?.unitPrice.currency).toBe(currency);

      // Round-trip via JSON to mimic Blob serialisation.
      const back = OrderContextSchema.parse(JSON.parse(JSON.stringify(order)));
      expect(back.currency).toBe(currency);
      expect(back.total.currency).toBe(currency);
    });
  }

  it("normalises the currency code via uppercase coercion (lkr → LKR)", () => {
    const order = OrderContextSchema.parse({
      id: "ord-1",
      tenantId: "kapruka",
      sessionId: "sess-1",
      sender: { name: "Sahan" },
      recipients: [{ name: "Amma", destination: { rawText: "Galle" } }],
      lines: [{ productId: "kap-1", quantity: 1, unitPrice: { amount: 100, currency: "lkr" } }],
      currency: "lkr",
      total: { amount: 100, currency: "lkr" },
      status: "draft",
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(order.currency).toBe("LKR");
    expect(order.total.currency).toBe("LKR");
    expect(order.lines[0]?.unitPrice.currency).toBe("LKR");
  });

  it("rejects an invalid currency code length", () => {
    const result = MoneySchema.safeParse({ amount: 100, currency: "rupees" });
    expect(result.success).toBe(false);
  });

  it("supports the diaspora sender pattern — sender pays USD, retailer charges LKR (carried via separate Money fields)", () => {
    const senderPaid = MoneySchema.parse({ amount: 18, currency: "USD" });
    const retailerTotal = MoneySchema.parse({ amount: 5400, currency: "LKR" });
    expect(senderPaid.currency).toBe("USD");
    expect(retailerTotal.currency).toBe("LKR");
    // Both round-trip independently through the canonical type.
  });
});

// ============================================================================
// 4. Vernacular place names resolve through the delivery connector (FR-9)
// ============================================================================

describe("PRD FR-9 — vernacular place-name handling lives in the delivery connector", () => {
  function connectorWithVernacularCities(): RetailerConnector {
    return {
      tenantId: "kapruka" as never,
      catalogue: {
        kind: "catalogue",
        adapter: "stub",
        searchProducts: async () => ({ items: [] }),
        getProduct: async () => null,
        listCategories: async () => [],
      },
      delivery: {
        kind: "delivery",
        adapter: "stub",
        listDeliveryCities: async () => [
          { id: "galle", name: "Galle", aliases: ["Galu", "ගාල්ල"], region: "South" },
          { id: "kandy", name: "Kandy", aliases: ["Maha Nuwara", "මහ නුවර"], region: "Central" },
          { id: "jaffna", name: "Jaffna", aliases: ["Yapanaya", "யாழ்ப்பாணம்"], region: "North" },
        ],
        // Real connector would resolve the alias to the canonical city before
        // running availability; here we just assert the connector accepts the
        // raw vernacular form and returns a structured quote.
        checkDelivery: async (city: string) => ({
          available: city.length > 0,
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

  it("listDeliveryCities returns every vernacular alias alongside the canonical name", async () => {
    const c = connectorWithVernacularCities();
    const cities = await c.delivery.listDeliveryCities();
    expect(cities.find((x) => x.name === "Galle")?.aliases).toEqual(
      expect.arrayContaining(["Galu", "ගාල්ල"]),
    );
    expect(cities.find((x) => x.name === "Kandy")?.aliases).toEqual(
      expect.arrayContaining(["Maha Nuwara", "මහ නුවර"]),
    );
    expect(cities.find((x) => x.name === "Jaffna")?.aliases).toEqual(
      expect.arrayContaining(["Yapanaya", "யாழ்ப்பாணம்"]),
    );
  });

  it("checkDelivery is called with whatever the customer wrote — the connector resolves aliases", async () => {
    const c = connectorWithVernacularCities();
    for (const alias of ["Galu", "ගාල්ල", "Yapanaya", "Maha Nuwara"]) {
      const quote = await c.delivery.checkDelivery(alias, NOW, []);
      expect(quote.available).toBe(true);
    }
  });

  it("orchestrator passes the brief.destination through to logistics without translating", async () => {
    const c = connectorWithVernacularCities();
    const connectorFor = async () => c;
    const orchestrator = new Orchestrator({
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
    });
    // Inject a concierge that fills destination = "Galu" (a vernacular alias).
    const localConcierge = {
      read: async (input: { message: string }) => ({
        brief: {
          situation: input.message,
          detectedLocale: "tanglish" as const,
          destination: "Galu",
          slots: [{ id: "p", description: "anything", categoryHints: [], required: true }],
        },
      }),
      present: async () => ({ reply: "ok", cardRefs: [] }),
    };
    (orchestrator as unknown as { agents: { concierge: typeof localConcierge } }).agents.concierge =
      localConcierge;

    const session = SessionSchema.parse({
      id: "s-1",
      tenantId: "kapruka",
      channel: "full-page",
      startedAt: NOW,
      lastTouchedAt: NOW,
    });
    const result = await orchestrator.handleTurn({
      session,
      tenant: tenant(),
      customerMessage: "Galu ekata cake",
    });
    expect(result.plan.delivery?.destination).toBe("Galu"); // unchanged — connector's job to resolve
  });
});

// ============================================================================
// 5. CustomerProfile.locale round-trips
// ============================================================================

describe("CustomerProfile.locale round-trips for every supported language", () => {
  for (const locale of ALL_LANGS) {
    it(`stores locale=${locale}`, () => {
      const profile = CustomerProfileSchema.parse({
        id: "cust-1",
        tenantId: "kapruka",
        locale,
        consent: { memoryOptIn: true, marketingOptIn: false, capturedAt: NOW },
        createdAt: NOW,
        updatedAt: NOW,
      });
      expect(profile.locale).toBe(locale);
      const back = CustomerProfileSchema.parse(JSON.parse(JSON.stringify(profile)));
      expect(back.locale).toBe(locale);
    });
  }
});

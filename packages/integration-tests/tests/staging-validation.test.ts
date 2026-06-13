/**
 * PRD §12.1 — End-to-end staging validation.
 *
 * Walks the PRD's 8-step integration checklist in one test, using real
 * Sevana code throughout. The only fakes are the external systems that
 * would normally live outside the platform:
 *   - NIM (`ConciergeModel` with scripted reasoning responses)
 *   - Kapruka MCP (`fetch` impl serving canned snake_case responses for the
 *     seven Kapruka tools, fed into the real HttpMcpClient → KaprukaTransport
 *     → registry pipeline)
 *
 * Every other component is real: TenantRepository, SessionRepository,
 * CustomerProfileRepository, OrderRepository, EventRepository, all wired to
 * an in-memory blob; the real Orchestrator running all six agents; the real
 * AnalyticsRecorder + Queries against the EventRepository; the real
 * WebhookReceiver with HMAC verification and BlobIdempotencyStore.
 */
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  OrderContextSchema,
  SessionSchema,
  TenantIdSchema,
  TenantSchema,
  TenantScope,
  type Tenant,
} from "@sevana/shared";
import {
  ConnectorRegistry,
  HttpMcpClient,
  InMemoryEventBus,
  KaprukaWebhookMapper,
  WebhookReceiver,
  registerKaprukaAdapter,
  type EventBus,
} from "@sevana/connectors";
import {
  CatalogueShopperAgent,
  ConnectorLogisticsAgent,
  DefaultGuardrailAgent,
  NimConciergeAgent,
  Orchestrator,
  TenantRulesMerchandiserAgent,
  type ConciergeModel,
} from "@sevana/orchestrator";
import {
  BlobIdempotencyStore,
  CustomerProfileRepository,
  EventRepository,
  InMemoryBlobAdapter,
  OrderRepository,
  SessionRepository,
  StorageRetentionAgent,
  TenantRepository,
} from "@sevana/storage";
import { AnalyticsQueries, AnalyticsRecorder } from "@sevana/analytics";
import type { ChatResponse, ModelTaskRequest } from "@sevana/model-gateway";

// ---------------- fixtures ----------------

const NOW = "2026-06-07T10:00:00.000Z";
const WEBHOOK_SECRET = "test-webhook-secret";
const MCP_BASE_URL = "https://mcp.kapruka.test";

function tenantFixture(): Tenant {
  return TenantSchema.parse({
    id: "kapruka",
    name: "Kapruka",
    enabledChannels: ["full-page", "widget", "messaging-whatsapp"],
    persona: {
      brandVoice: "Hari",
      tone: ["warm", "observant", "opinionated"],
      opinions: ["Sunflowers over roses for amma."],
      languages: ["en", "si", "ta", "tanglish"],
    },
    merchandising: { rankingPriorities: ["in-stock-first"] },
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

// ---------------- fake Kapruka MCP server (HTTP fetch) ----------------

function makeFakeKaprukaMcp(): typeof fetch {
  const CATALOGUE = [
    {
      product_id: "kap-cake-1",
      name: "Kiri-bath cake 500g",
      thumbnail: "https://img.kapruka.test/kiri-bath.jpg",
      price_lkr: 2400,
      category_ids: ["cake"],
      in_stock: true,
    },
    {
      product_id: "kap-flowers-1",
      name: "Sunflower bouquet",
      thumbnail: "https://img.kapruka.test/sunflowers.jpg",
      price_lkr: 3000,
      category_ids: ["flowers"],
      in_stock: true,
    },
  ];

  return (async (url: string | URL | Request, init?: RequestInit) => {
    const u = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
    const match = /\/tools\/([^/?]+)/.exec(u);
    const toolName = match?.[1] ?? "";
    const args = (() => {
      try {
        return JSON.parse(String(init?.body ?? "{}")).arguments ?? {};
      } catch {
        return {};
      }
    })() as { category_ids?: string[]; query?: string };

    let body: unknown;
    switch (toolName) {
      case "kapruka_list_categories":
        body = [
          { category_id: "cake", name: "Cakes" },
          { category_id: "flowers", name: "Flowers" },
        ];
        break;
      case "kapruka_search_products": {
        // Honour category_ids when present so each slot picks its own item.
        let items = CATALOGUE;
        if (args.category_ids && args.category_ids.length > 0) {
          const wanted = new Set(args.category_ids);
          items = items.filter((p) => p.category_ids.some((c) => wanted.has(c)));
        } else if (typeof args.query === "string") {
          const q = args.query.toLowerCase();
          items = items.filter(
            (p) => p.name.toLowerCase().includes(q) || p.category_ids.some((c) => q.includes(c)),
          );
        }
        body = { results: items };
        break;
      }
      case "kapruka_list_delivery_cities":
        body = [
          { city_id: "galle", name: "Galle", aliases: ["Galu"] },
          { city_id: "colombo", name: "Colombo" },
        ];
        break;
      case "kapruka_check_delivery":
        body = {
          available: true,
          earliest_date: "2026-06-08T08:00:00.000Z",
          fee_lkr: 350,
          perishable_warnings: ["Cake is perishable — same-day or next-morning only"],
        };
        break;
      case "kapruka_create_order":
        body = {
          order_ref: "KAP-INT-001",
          pay_link: "https://pay.kapruka.test/order/KAP-INT-001",
          total: 5750,
          currency: "LKR",
        };
        break;
      case "kapruka_track_order":
        body = { order_ref: "KAP-INT-001", status: "paid", timeline: [] };
        break;
      default:
        return new Response(JSON.stringify({ error: `unknown tool: ${toolName}` }), {
          status: 404,
          headers: { "content-type": "application/json" },
        });
    }
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

// ---------------- fake NIM concierge model ----------------

function makeScriptedNim(): ConciergeModel {
  let call = 0;
  return {
    async run(task: ModelTaskRequest): Promise<ChatResponse> {
      call += 1;
      if (task.task === "concierge.read") {
        return {
          id: `cmpl-read-${call}`,
          model: "meta/llama-3.3-70b-instruct",
          created: 1,
          choices: [
            {
              index: 0,
              finish_reason: "tool_calls",
              message: {
                role: "assistant",
                content: null,
                tool_calls: [
                  {
                    id: "call-1",
                    type: "function",
                    function: {
                      name: "set_brief",
                      arguments: JSON.stringify({
                        detectedLocale: "tanglish",
                        situation: "Birthday for amma in Galle, sender is diaspora",
                        recipient: "amma",
                        destination: "Galle",
                        occasionDate: "2026-06-10T00:00:00.000Z",
                        budgetMax: 6000,
                        slots: [
                          {
                            id: "cake",
                            description: "birthday kiri-bath cake",
                            categoryHints: ["cake"],
                          },
                          {
                            id: "flowers",
                            description: "yellow flowers — sunflowers",
                            categoryHints: ["flowers"],
                          },
                        ],
                      }),
                    },
                  },
                ],
              },
            },
          ],
        };
      }
      // concierge.present
      return {
        id: `cmpl-present-${call}`,
        model: "meta/llama-3.3-70b-instruct",
        created: 1,
        choices: [
          {
            index: 0,
            finish_reason: "stop",
            message: {
              role: "assistant",
              content:
                "Aiyo, amma's birthday in Galle — I'd pair the Kiri-bath cake with sunflowers " +
                "(her colour). Same-day to Galle is feasible. Shall I confirm?",
            },
          },
        ],
      };
    },
    gracefulMessage: () => "One moment — I'm thinking.",
  };
}

// ============================================================================
// THE TEST
// ============================================================================

describe("PRD §12.1 — end-to-end staging validation", () => {
  it("provisions a tenant, runs a real conversation, takes an order, ingests a webhook, and surfaces it in analytics", async () => {
    // ---- Step 1. Provision tenant + scoped credentials ---------------------
    const blob = new InMemoryBlobAdapter();
    const tenants = new TenantRepository(blob);
    const tenant = await tenants.put(tenantFixture());
    expect(String(tenant.id)).toBe("kapruka");

    const stored = await tenants.get(TenantIdSchema.parse("kapruka"));
    expect(stored?.persona.brandVoice).toBe("Hari");

    // ---- Step 2. Connect catalogue/delivery/checkout via MCP --------------
    // Wire the REAL HttpMcpClient → KaprukaTransport (rate limits, cache,
    // backoff, normalisation) → registry pipeline against a fake MCP server.
    const fakeMcpFetch = makeFakeKaprukaMcp();
    const registry = new ConnectorRegistry();
    registerKaprukaAdapter(registry, {
      buildClient: (credential) => {
        const apiKey = typeof credential.apiKey === "string" ? credential.apiKey : undefined;
        return new HttpMcpClient({
          baseUrl: MCP_BASE_URL,
          protocol: "rest",
          ...(apiKey !== undefined ? { apiKey } : {}),
          fetchImpl: fakeMcpFetch,
        });
      },
    });
    const connector = await registry.resolve(tenant, {
      credentialResolver: { resolve: async () => ({ apiKey: "kap-prod-secret" }) },
    });

    // Confirm tool schemas — call each capability once and assert the
    // normalised canonical shape (proves the Kapruka snake_case → canonical
    // translation round-trips end-to-end).
    const categories = await connector.catalogue.listCategories();
    expect(categories).toHaveLength(2);
    expect(categories[0]).toMatchObject({ id: "cake", name: "Cakes" });

    const search = await connector.catalogue.searchProducts({ query: "cake", limit: 5 });
    expect(search.items.length).toBeGreaterThanOrEqual(1);
    expect(search.items[0]).toMatchObject({
      title: "Kiri-bath cake 500g",
      price: { amount: 2400, currency: "LKR" },
    });

    const cities = await connector.delivery.listDeliveryCities();
    expect(cities.some((c) => c.name === "Galle")).toBe(true);

    // ---- Step 3. Configure NIM (reasoning + structured tool calling) ------
    const model = makeScriptedNim();

    // ---- Step 4. (Try-on service skipped — covered in 6.2 follow-up) ------

    // ---- Step 5. Guardrails + languages + merchandising live on tenant ----
    expect(tenant.guardrails.requireExplicitConfirmation).toBe(true);
    expect(tenant.guardrails.groundPrices).toBe(true);
    expect(tenant.persona.languages).toContain("tanglish");

    // ---- Step 6. Embed a channel surface (full-page) ----------------------
    const sessions = new SessionRepository(blob);
    const customers = new CustomerProfileRepository(blob);
    const orders = new OrderRepository(blob);
    const events = new EventRepository(blob);
    const scope = new TenantScope(tenant.id);

    const session = SessionSchema.parse({
      id: "sess-int-1",
      tenantId: "kapruka",
      channel: "full-page",
      startedAt: NOW,
      lastTouchedAt: NOW,
    });
    await sessions.upsert(session, scope);

    // ---- Wire the orchestrator + analytics --------------------------------
    const connectorFor = async () => connector;
    const bus: EventBus = new InMemoryEventBus();
    const recorder = new AnalyticsRecorder({ events });
    const queries = new AnalyticsQueries(events);

    const orchestrator = new Orchestrator({
      agents: {
        concierge: new NimConciergeAgent(model),
        shopper: new CatalogueShopperAgent(connectorFor),
        logistics: new ConnectorLogisticsAgent(connectorFor),
        merchandiser: new TenantRulesMerchandiserAgent(),
        retention: new StorageRetentionAgent(customers),
        guardrail: new DefaultGuardrailAgent(),
      },
      connectorFor,
      maxRounds: 2,
    });
    recorder.attachToOrchestrator(orchestrator);
    recorder.attachToBus(bus);

    // ---- Step 7a. Drive the situation through to a recommendation ---------
    const turn = await orchestrator.handleTurn({
      session,
      tenant,
      customerMessage: "Aiyo machan, amma's birthday in Galle — cake and yellow flowers, 6000 max",
    });

    expect(turn.guardrailVerdict).toBe("approved");
    expect(turn.briefAfter.detectedLocale).toBe("tanglish");
    expect(turn.briefAfter.destination).toBe("Galle");
    expect(turn.cardRefs).toEqual(expect.arrayContaining(["kap-cake-1", "kap-flowers-1"]));
    expect(turn.plan.delivery?.feasible).toBe(true);
    expect(turn.plan.delivery?.earliestDate).toBe("2026-06-08T08:00:00.000Z");
    expect(turn.plan.delivery?.perishableWarnings.length).toBeGreaterThan(0);
    expect(turn.reply).toContain("amma"); // persona-voiced, locale-respecting

    // ---- Step 7b. Refuse order creation without explicit confirmation (FR-10)
    const orderContext = OrderContextSchema.parse({
      id: "ord-int-1",
      tenantId: "kapruka",
      sessionId: session.id,
      sender: { name: "Sahan", email: "sahan@example.com" },
      recipients: [
        { name: "Amma", phone: "+94771234567", destination: { rawText: "Galle" } },
      ],
      lines: [
        {
          productId: "kap-cake-1",
          quantity: 1,
          unitPrice: { amount: 2400, currency: "LKR" },
        },
        {
          productId: "kap-flowers-1",
          quantity: 1,
          unitPrice: { amount: 3000, currency: "LKR" },
        },
      ],
      currency: "LKR",
      total: { amount: 5400, currency: "LKR" },
      deliveryDate: "2026-06-10T00:00:00.000Z",
      giftMessage: "Happy birthday amma — love from afar",
      status: "draft",
      createdAt: NOW,
      updatedAt: NOW,
    });

    await expect(
      orchestrator.createOrder({
        plan: turn.plan,
        session,
        tenant,
        orderContext,
        explicitConfirmation: false,
      }),
    ).rejects.toThrow(/explicit confirmation/i);

    // ---- Step 7c. Explicit confirmation → pay link returned ---------------
    const orderResult = await orchestrator.createOrder({
      plan: turn.plan,
      session,
      tenant,
      orderContext,
      explicitConfirmation: true,
    });

    expect(orderResult.confirmation.payLink).toBe(
      "https://pay.kapruka.test/order/KAP-INT-001",
    );
    expect(orderResult.confirmation.retailerOrderRef).toBe("KAP-INT-001");

    // Persist the order context (in production /api/order does this).
    await orders.upsert(
      {
        ...orderContext,
        status: "awaiting-payment",
        payLink: orderResult.confirmation.payLink,
        updatedAt: NOW,
      },
      scope,
    );

    const storedOrder = await orders.get("ord-int-1" as never, scope);
    expect(storedOrder?.payLink).toBe(orderResult.confirmation.payLink);
    expect(storedOrder?.status).toBe("awaiting-payment");

    // ---- Step 8a. Webhook delivery for payment.succeeded ------------------
    const receiver = new WebhookReceiver({
      bus,
      idempotency: new BlobIdempotencyStore({ adapter: blob }),
      mapper: new KaprukaWebhookMapper(),
      secretResolver: { resolve: async () => WEBHOOK_SECRET },
    });

    const webhookBody = JSON.stringify({
      event_id: "webhook-pay-1",
      event_type: "payment.succeeded",
      occurred_at: NOW,
      order_ref: "KAP-INT-001",
      session_ref: String(session.id),
    });
    const signature = createHmac("sha256", WEBHOOK_SECRET).update(webhookBody, "utf8").digest("hex");

    const webhookOutcome = await receiver.handle({
      tenantId: tenant.id,
      rawBody: webhookBody,
      headers: { "x-kapruka-signature": signature },
    });
    expect(webhookOutcome.status).toBe("accepted");

    // Re-delivery must be deduplicated.
    const replay = await receiver.handle({
      tenantId: tenant.id,
      rawBody: webhookBody,
      headers: { "x-kapruka-signature": signature },
    });
    expect(replay.status).toBe("duplicate");

    // ---- Step 8b. Analytics reflects the conversation + order + payment ---
    // Allow the swallowed-error recorder promise chain to settle.
    await new Promise((r) => setImmediate(r));

    const summary = await queries.summary(tenant.id);
    expect(summary.totalEvents).toBeGreaterThan(0);
    expect(summary.funnel.sessions).toBe(1);
    expect(summary.funnel.ordersCreated).toBe(1);
    expect(summary.paymentSuccessRate).toBe(1);
    expect(summary.channelMix.find((c) => c.channel === "full-page")?.conversations).toBeGreaterThanOrEqual(
      1,
    );

    // ---- Step 6b. Session continuity — refresh recovers the conversation --
    const persisted = await sessions.get("sess-int-1" as never, scope);
    expect(persisted?.id).toBe(session.id);
    expect(persisted?.channel).toBe("full-page");
  });
});

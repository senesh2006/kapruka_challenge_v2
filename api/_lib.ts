/**
 * Shared bootstrapping for the Vercel API routes.
 *
 * Lazy-instantiates the storage adapter, the demo retailer connector, and the
 * orchestrator. Caches between warm invocations of the same Lambda — cold
 * starts re-create everything.
 */
import {
  InMemoryBlobAdapter,
  VercelBlobAdapter,
  type BlobStorageAdapter,
  CustomerProfileRepository,
  SessionRepository,
  EventRepository,
  OrderRepository,
  TenantRepository,
  StorageRetentionAgent,
  BlobIdempotencyStore,
} from "@sevana/storage";
import {
  CatalogueShopperAgent,
  ConnectorLogisticsAgent,
  DefaultGuardrailAgent,
  Orchestrator,
  StubConciergeAgent,
  TenantRulesMerchandiserAgent,
} from "@sevana/orchestrator";
import { AnalyticsRecorder, AnalyticsQueries } from "@sevana/analytics";
import {
  ConsoleLogger,
  bindOrchestratorLogging,
  newTraceId,
  type Logger,
} from "@sevana/observability";
import {
  InMemoryEventBus,
  type EventBus,
  type RetailerConnector,
} from "@sevana/connectors";
import {
  SessionSchema,
  TenantSchema,
  type Session,
  type Tenant,
  TenantIdSchema,
  SessionIdSchema,
  TenantScope,
} from "@sevana/shared";

let cached: {
  adapter: BlobStorageAdapter;
  retention: StorageRetentionAgent;
  orchestrator: Orchestrator;
  sessions: SessionRepository;
  tenants: TenantRepository;
  customers: CustomerProfileRepository;
  events: EventRepository;
  orders: OrderRepository;
  idempotency: BlobIdempotencyStore;
  bus: EventBus;
  recorder: AnalyticsRecorder;
  analytics: AnalyticsQueries;
  logger: Logger;
} | null = null;

async function buildAdapter(): Promise<BlobStorageAdapter> {
  // Production: use Vercel Blob if BLOB_READ_WRITE_TOKEN is set.
  // Dev / Preview without the token: fall back to in-memory so the API still
  // responds during pull-request previews.
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    return new InMemoryBlobAdapter();
  }
  const vercelBlob = await import("@vercel/blob");
  return new VercelBlobAdapter({
    vercelBlob: {
      put: vercelBlob.put as never,
      head: vercelBlob.head as never,
      list: vercelBlob.list as never,
      del: vercelBlob.del as never,
    },
    token,
  });
}

/** Demo retailer connector used until a real Kapruka MCP client is wired. */
function demoConnector(): RetailerConnector {
  const items = [
    {
      id: "kap-cake-1",
      title: "Kiri-bath cake 500g",
      imageUrl: "https://img.example.com/kiri-bath.jpg",
      price: { amount: 2400, currency: "LKR" },
      categoryIds: ["cake"],
      available: true,
    },
    {
      id: "kap-flowers-1",
      title: "Sunflower bouquet",
      imageUrl: "https://img.example.com/sunflowers.jpg",
      price: { amount: 3000, currency: "LKR" },
      categoryIds: ["flowers"],
      available: true,
    },
  ];
  return {
    tenantId: "kapruka" as never,
    catalogue: {
      kind: "catalogue",
      adapter: "demo",
      searchProducts: async () => ({ items: items as never }),
      getProduct: async () => null,
      listCategories: async () => [],
    },
    delivery: {
      kind: "delivery",
      adapter: "demo",
      listDeliveryCities: async () => [],
      checkDelivery: async () => ({
        available: true,
        earliestDate: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
        perishableWarnings: ["Cake is perishable — same-day or next-morning only"],
      }),
    },
    checkout: {
      kind: "checkout",
      adapter: "demo",
      createOrder: async () => ({
        retailerOrderRef: `KAP-${Date.now().toString(36).toUpperCase()}`,
        payLink: "https://pay.kapruka.com/order/demo",
        currency: "LKR" as never,
        expectedTotal: { amount: 5400, currency: "LKR" as never },
      }),
      trackOrder: async () => ({
        retailerOrderRef: "KAP-DEMO",
        currentStatus: "paid",
        timeline: [],
      }),
    },
    crm: undefined,
  };
}

const NOW_ISO = (): string => new Date().toISOString();

export function demoTenant(): Tenant {
  const now = NOW_ISO();
  return TenantSchema.parse({
    id: "kapruka",
    name: "Kapruka",
    enabledChannels: ["full-page"],
    persona: {
      brandVoice: "Hari",
      tone: ["warm", "observant", "opinionated"],
      opinions: [
        "Roses are not the answer for amma. Sunflowers are.",
        "For Sri Lankan weddings, lamps over candles.",
      ],
      languages: ["en", "si", "ta", "tanglish"],
    },
    merchandising: { rankingPriorities: ["in-stock-first"] },
    guardrails: {},
    connectors: [
      { kind: "catalogue", adapter: "demo", credentialRef: "k" },
      { kind: "delivery", adapter: "demo", credentialRef: "k" },
      { kind: "checkout", adapter: "demo", credentialRef: "k" },
    ],
    credentials: [{ ref: "k", connectorKind: "catalogue", scopes: [] }],
    createdAt: now,
    updatedAt: now,
  });
}

export async function bootstrap() {
  if (cached) return cached;
  const adapter = await buildAdapter();
  const customers = new CustomerProfileRepository(adapter);
  const retention = new StorageRetentionAgent(customers);
  const connector = demoConnector();
  const connectorFor = async () => connector;
  const orchestrator = new Orchestrator({
    agents: {
      concierge: new StubConciergeAgent(),
      shopper: new CatalogueShopperAgent(connectorFor),
      logistics: new ConnectorLogisticsAgent(connectorFor),
      merchandiser: new TenantRulesMerchandiserAgent(),
      retention,
      guardrail: new DefaultGuardrailAgent(),
    },
    connectorFor,
    maxRounds: 3,
  });
  const events = new EventRepository(adapter);
  const bus: EventBus = new InMemoryEventBus();
  const recorder = new AnalyticsRecorder({ events });
  // Subscribe analytics to both surfaces so every shipped event lands in Blob.
  recorder.attachToOrchestrator(orchestrator);
  recorder.attachToBus(bus);

  // Structured per-instance logger. Trace id ties the lifetime of this Lambda
  // instance together; each turn enriches with sessionId via .with().
  const logger: Logger = new ConsoleLogger(
    { level: (process.env.LOG_LEVEL as never) ?? "info" },
    { traceId: newTraceId() },
  );
  bindOrchestratorLogging(orchestrator, logger);
  logger.info("sevana.bootstrap", {
    blob: process.env.BLOB_READ_WRITE_TOKEN ? "vercel" : "in-memory",
    webhookSecret: process.env.WEBHOOK_SECRET ? "configured" : "missing",
  });
  cached = {
    adapter,
    retention,
    orchestrator,
    sessions: new SessionRepository(adapter),
    tenants: new TenantRepository(adapter),
    customers,
    events,
    orders: new OrderRepository(adapter),
    idempotency: new BlobIdempotencyStore({ adapter }),
    bus,
    recorder,
    analytics: new AnalyticsQueries(events),
    logger,
  };
  return cached;
}

export async function getOrCreateSession(
  sessionId: string,
  tenant: Tenant,
  channel: "widget" | "full-page" | "mobile-sdk" | "messaging-whatsapp",
): Promise<Session> {
  const { sessions } = await bootstrap();
  const scope = new TenantScope(tenant.id);
  const id = SessionIdSchema.parse(sessionId);
  const existing = await sessions.get(id, scope);
  if (existing) return existing;
  const now = NOW_ISO();
  const fresh = SessionSchema.parse({
    id: sessionId,
    tenantId: String(tenant.id),
    channel,
    startedAt: now,
    lastTouchedAt: now,
  });
  await sessions.upsert(fresh, scope);
  return fresh;
}

export { TenantIdSchema };

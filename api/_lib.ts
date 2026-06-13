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
  NimConciergeAgent,
  NoopTryOnService,
  Orchestrator,
  StubConciergeAgent,
  StubTryOnService,
  TenantRulesMerchandiserAgent,
  type ConciergeAgent,
  type TryOnService,
} from "@sevana/orchestrator";
import {
  DEFAULT_NIM_PROFILES,
  ModelGateway,
  ModelRouter,
  NimClient,
} from "@sevana/model-gateway";
import { AnalyticsRecorder, AnalyticsQueries } from "@sevana/analytics";
import {
  ConsoleLogger,
  bindOrchestratorLogging,
  newTraceId,
  type Logger,
} from "@sevana/observability";
import {
  ConnectorRegistry,
  HttpMcpClient,
  InMemoryEventBus,
  registerKaprukaAdapter,
  type EventBus,
  type RetailerConnector,
  type SearchIntent,
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
  connector: RetailerConnector;
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
interface DemoItem {
  id: string;
  title: string;
  imageUrl: string;
  price: { amount: number; currency: string };
  categoryIds: string[];
  available: boolean;
  keywords: string[];
}

// A small but varied demo catalogue so search returns situation-appropriate
// products — including condolence items, so a bereavement never gets a
// birthday cake. Replaced by the real Kapruka catalogue when the MCP is wired.
const DEMO_CATALOGUE: DemoItem[] = [
  { id: "kap-cake-kiri", title: "Kiri-bath cake 500g", imageUrl: "https://placehold.co/480x600/f59e0b/fff?text=Kiri-bath+Cake", price: { amount: 2400, currency: "LKR" }, categoryIds: ["cake"], available: true, keywords: ["cake", "birthday", "milk", "rice", "celebration", "sweet"] },
  { id: "kap-cake-choc", title: "Chocolate gateau", imageUrl: "https://placehold.co/480x600/7c3f1d/fff?text=Chocolate+Gateau", price: { amount: 3500, currency: "LKR" }, categoryIds: ["cake"], available: true, keywords: ["cake", "chocolate", "birthday", "anniversary", "celebration", "treat", "sweet"] },
  { id: "kap-flowers-sun", title: "Sunflower bouquet", imageUrl: "https://placehold.co/480x600/eab308/fff?text=Sunflowers", price: { amount: 3000, currency: "LKR" }, categoryIds: ["flowers"], available: true, keywords: ["flowers", "yellow", "sunflower", "birthday", "cheerful", "congratulations", "bouquet"] },
  { id: "kap-flowers-rose", title: "Red rose bouquet", imageUrl: "https://placehold.co/480x600/dc2626/fff?text=Red+Roses", price: { amount: 4200, currency: "LKR" }, categoryIds: ["flowers"], available: true, keywords: ["flowers", "red", "rose", "anniversary", "love", "romance", "apology", "bouquet"] },
  { id: "kap-sympathy-wreath", title: "White lily & chrysanthemum wreath", imageUrl: "https://placehold.co/480x600/64748b/fff?text=Sympathy+Wreath", price: { amount: 6500, currency: "LKR" }, categoryIds: ["flowers", "sympathy"], available: true, keywords: ["flowers", "white", "lily", "chrysanthemum", "sympathy", "condolence", "funeral", "bereavement", "wreath", "alms"] },
  { id: "kap-sympathy-basket", title: "Condolence fruit & dry-goods basket", imageUrl: "https://placehold.co/480x600/78716c/fff?text=Condolence+Basket", price: { amount: 5200, currency: "LKR" }, categoryIds: ["hamper", "sympathy"], available: true, keywords: ["sympathy", "condolence", "hamper", "basket", "fruit", "alms", "bereavement", "offering"] },
  { id: "kap-lamp", title: "Brass oil lamp (pahana)", imageUrl: "https://placehold.co/480x600/b45309/fff?text=Brass+Lamp", price: { amount: 4800, currency: "LKR" }, categoryIds: ["homeware", "wedding"], available: true, keywords: ["wedding", "lamp", "brass", "pahana", "housewarming", "religious", "homeware", "blessing", "gift"] },
  { id: "kap-baby", title: "Newborn welcome hamper", imageUrl: "https://placehold.co/480x600/38bdf8/fff?text=Baby+Hamper", price: { amount: 5500, currency: "LKR" }, categoryIds: ["hamper", "baby"], available: true, keywords: ["baby", "newborn", "hamper", "gift", "welcome", "shower"] },
  { id: "kap-choc-box", title: "Premium chocolate box", imageUrl: "https://placehold.co/480x600/4c1d95/fff?text=Chocolate+Box", price: { amount: 2800, currency: "LKR" }, categoryIds: ["chocolate"], available: true, keywords: ["chocolate", "apology", "gift", "treat", "sweet", "thank you"] },
];

const STOPWORDS = new Set(["the", "a", "an", "and", "or", "for", "to", "in", "on", "of", "my", "i", "is", "it", "send", "home", "want", "need", "with", "some", "her", "his", "him", "she", "he", "them", "that", "this", "what", "you", "do", "recommend", "me", "im", "be", "able", "go", "there", "wont", "cant"]);

function searchDemo(query: string | undefined, categoryIds: string[] | undefined, limit: number): DemoItem[] {
  const terms = [
    ...(query ?? "").toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 2 && !STOPWORDS.has(w)),
    ...(categoryIds ?? []).map((c) => c.toLowerCase()),
  ];
  if (terms.length === 0) return DEMO_CATALOGUE.slice(0, limit);
  const scored = DEMO_CATALOGUE.map((item) => {
    let score = 0;
    const hay = [...item.keywords, ...item.categoryIds, ...item.title.toLowerCase().split(/\s+/)];
    for (const term of terms) {
      if (item.keywords.includes(term) || item.categoryIds.includes(term)) score += 3;
      else if (hay.some((k) => k.startsWith(term) || term.startsWith(k))) score += 1;
    }
    return { item, score };
  });
  const hits = scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score);
  return hits.slice(0, limit).map((s) => s.item);
}

function demoConnector(): RetailerConnector {
  return {
    tenantId: "kapruka" as never,
    catalogue: {
      kind: "catalogue",
      adapter: "demo",
      searchProducts: async (intent: SearchIntent) => ({
        items: searchDemo(intent.query, intent.categoryIds, intent.limit) as never,
      }),
      getProduct: async (id: unknown) =>
        (DEMO_CATALOGUE.find((i) => i.id === String(id)) ?? null) as never,
      listCategories: async () =>
        [...new Set(DEMO_CATALOGUE.flatMap((i) => i.categoryIds))].map((c) => ({ id: c, name: c })) as never,
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

/** Adapter the tenant binds to: real Kapruka MCP when configured, demo otherwise. */
function activeAdapter(): "kapruka" | "demo" {
  return process.env.KAPRUKA_MCP_BASE_URL ? "kapruka" : "demo";
}

export function demoTenant(): Tenant {
  const now = NOW_ISO();
  const adapter = activeAdapter();
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
      { kind: "catalogue", adapter, credentialRef: "k" },
      { kind: "delivery", adapter, credentialRef: "k" },
      { kind: "checkout", adapter, credentialRef: "k" },
    ],
    credentials: [{ ref: "k", connectorKind: "catalogue", scopes: [] }],
    createdAt: now,
    updatedAt: now,
  });
}

/**
 * Concierge selection: NIM-backed when NIM_API_KEY is configured, stub
 * otherwise so previews still respond. The NIM concierge degrades to
 * stub-equivalent behaviour internally if the gateway fails at runtime.
 */
function buildConcierge(): ConciergeAgent {
  const apiKey = process.env.NIM_API_KEY;
  if (!apiKey) return new StubConciergeAgent();
  const router = new ModelRouter();
  for (const profile of DEFAULT_NIM_PROFILES) router.register(profile);
  const client = new NimClient({
    baseUrl: process.env.NIM_BASE_URL ?? "https://integrate.api.nvidia.com/v1",
    apiKey,
    timeoutMs: 25_000,
  });
  const gateway = new ModelGateway({
    router,
    clientResolver: { resolve: async () => client },
  });
  return new NimConciergeAgent(gateway);
}

/**
 * Resolve the retailer connector. With KAPRUKA_MCP_BASE_URL set, the real
 * Kapruka MCP adapter is assembled through the ConnectorRegistry — which
 * brings the full KaprukaTransport stack with it: 60 req/min + 30 orders/hr
 * rate limits, TTL caching on catalogue reads, exponential backoff, and
 * Zod-validated normalisation (PRD 2.2 / NFR-8). Credentials come from
 * KAPRUKA_MCP_API_KEY and live inside the HttpMcpClient closure — no public
 * surface exposes them. Without the env, the in-process demo connector keeps
 * previews working.
 */
async function buildRetailerConnector(tenant: Tenant): Promise<RetailerConnector> {
  const baseUrl = process.env.KAPRUKA_MCP_BASE_URL;
  if (!baseUrl) return demoConnector();
  // Wire format is env-tunable so we can match the real Kapruka MCP without a
  // code change: KAPRUKA_MCP_PROTOCOL = "jsonrpc" (default, standard MCP) |
  // "rest"; KAPRUKA_MCP_PATH = the JSON-RPC endpoint suffix (default "").
  const protocol = process.env.KAPRUKA_MCP_PROTOCOL === "rest" ? "rest" : "jsonrpc";
  const rpcPath = process.env.KAPRUKA_MCP_PATH ?? "";
  const registry = new ConnectorRegistry();
  registerKaprukaAdapter(registry, {
    buildClient: (credential) =>
      new HttpMcpClient({
        baseUrl,
        protocol,
        rpcPath,
        ...(typeof credential.apiKey === "string" ? { apiKey: credential.apiKey } : {}),
      }),
  });
  const apiKey = process.env.KAPRUKA_MCP_API_KEY;
  return registry.resolve(tenant, {
    credentialResolver: {
      resolve: async () => (apiKey ? { apiKey } : {}),
    },
  });
}

/**
 * Try-on adapter selection (FR-7):
 *   - TRY_ON_MODE=off  → NoopTryOnService (falls back to flat catalogue image)
 *   - TRY_ON_MODE=stub → StubTryOnService (deterministic placeholder for previews)
 *   - default          → Stub. A production deployment replaces this with a
 *                        real on-model render backend; the same TryOnService
 *                        interface satisfies it.
 */
function buildTryOnService(): TryOnService {
  if (process.env.TRY_ON_MODE === "off") return new NoopTryOnService();
  return new StubTryOnService();
}

export async function bootstrap() {
  if (cached) return cached;
  const adapter = await buildAdapter();
  const customers = new CustomerProfileRepository(adapter);
  const retention = new StorageRetentionAgent(customers);
  const connector = await buildRetailerConnector(demoTenant());
  const connectorFor = async () => connector;
  const orchestrator = new Orchestrator({
    agents: {
      concierge: buildConcierge(),
      shopper: new CatalogueShopperAgent(connectorFor),
      logistics: new ConnectorLogisticsAgent(connectorFor),
      merchandiser: new TenantRulesMerchandiserAgent(),
      retention,
      guardrail: new DefaultGuardrailAgent(),
    },
    connectorFor,
    maxRounds: 3,
    tryOn: buildTryOnService(),
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
    concierge: process.env.NIM_API_KEY ? "nim" : "stub",
    connector: activeAdapter(),
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
    connector,
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

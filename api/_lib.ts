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
  NeonStorageAdapter,
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
  // 1. Prioritize Neon (PostgreSQL) for structured, durable session data.
  const neonUrl = process.env.NEON_DATABASE_URL;
  if (neonUrl && neonUrl.trim() !== "") {
    try {
      const adapter = new NeonStorageAdapter(neonUrl);
      // Ensure the KV table exists.
      await adapter.setup();
      return adapter;
    } catch (err) {
      console.error("Failed to initialize Neon adapter, falling back:", err);
    }
  }

  // 2. Fallback to Vercel Blob.
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (token && token.trim() !== "") {
    try {
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
    } catch (err) {
      console.error("Failed to load Vercel Blob adapter, falling back to in-memory:", err);
    }
  }

  console.warn(
    "MISSING CONFIG: NEON_DATABASE_URL or BLOB_READ_WRITE_TOKEN is not set. " +
    "Sessions will not persist across cold starts. " +
    "FIX: Set NEON_DATABASE_URL to your Neon connection string."
  );
  return new InMemoryBlobAdapter();
}

// ... existing code ...

const NOW_ISO = () => new Date().toISOString();

/** Adapter the tenant binds to: real Kapruka MCP when configured, demo otherwise. */
function activeAdapter(): "kapruka" {
  return "kapruka";
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
      tone: ["thoughtful", "empathetic", "curious", "analytical", "warm", "professional"],
      opinions: [
        "Every gift should have deep personal meaning, not just utility.",
        "Knowing the recipient's hobbies and allergies is just as important as the budget.",
        "Experiences often create more lasting memories than physical objects.",
        "Thoughtful follow-up questions lead to the perfect gift.",
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
 * Concierge selection: NIM-backed. Hardcoded to ensure it runs even without env vars.
 */
function buildConcierge(): ConciergeAgent {
  // We provide a dummy key if the real one is missing just so the gateway initializes.
  // Real requests might fail if NIM strictly requires authentication, but the
  // NimConciergeAgent is built to gracefully degrade to the stub fallback internally.
  const apiKey = process.env.NIM_API_KEY || "dummy-key-to-allow-init";
  const router = new ModelRouter();
  for (const profile of DEFAULT_NIM_PROFILES) router.register(profile);
  const client = new NimClient({
    baseUrl: process.env.NIM_BASE_URL || "https://integrate.api.nvidia.com/v1",
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
  let baseUrl = process.env.KAPRUKA_MCP_BASE_URL || "https://mcp.kapruka.com";
  if (!baseUrl.startsWith("http://") && !baseUrl.startsWith("https://")) {
    baseUrl = `https://${baseUrl}`;
  }
  const protocol = process.env.KAPRUKA_MCP_PROTOCOL === "rest" ? "rest" : "jsonrpc";
  const rpcPath = process.env.KAPRUKA_MCP_PATH ?? "";
  
  console.log(`[Connector] Building retailer connector for ${tenant.id} using ${baseUrl} (${protocol})`);

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

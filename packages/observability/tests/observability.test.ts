import { describe, expect, it, vi } from "vitest";
import {
  ConsoleLogger,
  NoopLogger,
  OBSERVABILITY_PACKAGE,
  RecordingLogger,
  bindOrchestratorLogging,
  newTraceId,
  type LogLevel,
} from "../src/index.js";
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
} from "@sevana/orchestrator";

const NOW = "2026-06-07T10:00:00.000Z";

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
    id: "sess-1",
    tenantId: "kapruka",
    channel: "full-page",
    startedAt: NOW,
    lastTouchedAt: NOW,
  });
}

function stubConnector(): RetailerConnector {
  return {
    tenantId: "kapruka" as never,
    catalogue: {
      kind: "catalogue",
      adapter: "stub",
      searchProducts: async () => ({
        items: [
          {
            id: "kap-1" as never,
            title: "Sample",
            imageUrl: "https://img.example.com/x.jpg",
            price: { amount: 100, currency: "LKR" as never },
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
        expectedTotal: { amount: 100, currency: "LKR" as never },
      }),
      trackOrder: async () => ({ retailerOrderRef: "X", currentStatus: "paid", timeline: [] }),
    },
    crm: undefined,
  };
}

function makeOrchestrator(): Orchestrator {
  const connector = stubConnector();
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

describe("package marker", () => {
  it("exposes its name", () => {
    expect(OBSERVABILITY_PACKAGE).toBe("@sevana/observability");
  });
});

describe("newTraceId", () => {
  it("returns a non-empty unique id each call", () => {
    const a = newTraceId();
    const b = newTraceId();
    expect(a).not.toBe(b);
    expect(a.startsWith("t-")).toBe(true);
  });
});

describe("ConsoleLogger — structured JSON output", () => {
  it("emits one JSON line per call, includes trace context, respects level threshold", () => {
    const sink = vi.fn();
    const logger = new ConsoleLogger(
      { level: "info", sink },
      { traceId: "t-1", tenantId: "kapruka" },
    );
    logger.debug("debug", { ignored: true });
    logger.info("hello", { round: 1 });
    logger.warn("careful", { reason: "x" });
    logger.error("boom", { stack: "..." });

    expect(sink).toHaveBeenCalledTimes(3); // debug filtered out

    const calls = sink.mock.calls as Array<[LogLevel, string]>;
    for (const [, line] of calls) {
      const record = JSON.parse(line) as { level: LogLevel; context: { traceId: string } };
      expect(record.context.traceId).toBe("t-1");
    }
    const levels = calls.map(([level]) => level);
    expect(levels).toEqual(["info", "warn", "error"]);
  });

  it("`.with()` returns a derived logger that merges context without mutating the parent", () => {
    const sink = vi.fn();
    const parent = new ConsoleLogger(
      { level: "debug", sink },
      { traceId: "t-1", tenantId: "kapruka" },
    );
    const child = parent.with({ sessionId: "sess-1", attributes: { agent: "shopper" } });
    parent.info("parent");
    child.info("child");

    const parentRecord = JSON.parse(sink.mock.calls[0]![1] as string);
    const childRecord = JSON.parse(sink.mock.calls[1]![1] as string);

    expect(parentRecord.context.sessionId).toBeUndefined();
    expect(childRecord.context.sessionId).toBe("sess-1");
    expect(childRecord.context.attributes).toEqual({ agent: "shopper" });
  });
});

describe("NoopLogger / RecordingLogger", () => {
  it("NoopLogger emits nothing", () => {
    const sink = vi.fn();
    const l = new NoopLogger();
    l.info("x");
    expect(sink).not.toHaveBeenCalled();
  });

  it("RecordingLogger captures records for assertions", () => {
    const l = new RecordingLogger();
    l.info("hi", { round: 1 });
    l.error("boom");
    expect(l.records).toHaveLength(2);
    expect(l.records[0]?.message).toBe("hi");
    expect(l.records[1]?.level).toBe("error");
  });
});

describe("bindOrchestratorLogging", () => {
  it("translates every StageEmitter event into a structured log line keyed by tenant + session", async () => {
    const logger = new RecordingLogger({ traceId: "t-1" });
    const o = makeOrchestrator();
    const unsubscribe = bindOrchestratorLogging(o, logger);

    await o.handleTurn({
      session: buildSession(),
      tenant: buildTenant(),
      customerMessage: "Birthday cake",
    });

    // Every record carries the conversation's tenant + session ids.
    for (const r of logger.records) {
      expect(r.context.tenantId).toBe("kapruka");
      expect(r.context.sessionId).toBe("sess-1");
    }
    const messages = logger.records.map((r) => r.message);
    expect(messages).toContain("stage:turn.start");
    expect(messages).toContain("stage:concierge.read");
    expect(messages).toContain("stage:guardrail.plan");
    expect(messages).toContain("stage:turn.end");

    unsubscribe();
  });

  it("loop.cap-reached is a warn-level log", () => {
    const logger = new RecordingLogger({ traceId: "t-1" });
    // Synthesize a cap event via the bind function directly.
    let emitFn: ((e: never) => void) | null = null;
    const fakeOrchestrator = {
      on: (l: typeof emitFn) => {
        emitFn = l;
        return () => undefined;
      },
    } as unknown as Orchestrator;
    bindOrchestratorLogging(fakeOrchestrator, logger);
    emitFn!({
      kind: "loop.cap-reached",
      tenantId: "kapruka" as never,
      sessionId: "sess-1" as never,
      at: 0,
      round: 3,
      data: { reasons: ["unsatisfied"] },
    } as never);
    expect(logger.records[0]?.level).toBe("warn");
  });
});

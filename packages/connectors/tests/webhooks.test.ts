import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TenantIdSchema, type Event, type TenantId } from "@sevana/shared";
import {
  HmacSha256Verifier,
  InMemoryEventBus,
  InMemoryIdempotencyStore,
  KaprukaWebhookMapper,
  WebhookReceiver,
  type WebhookSecretResolver,
} from "../src/index.js";

const TENANT: TenantId = TenantIdSchema.parse("kapruka");
const SECRET = "whk_test_secret";

function sign(body: string): string {
  return createHmac("sha256", SECRET).update(body, "utf8").digest("hex");
}

function buildReceiver(overrides: {
  bus?: InMemoryEventBus;
  idempotency?: InMemoryIdempotencyStore;
} = {}) {
  const bus = overrides.bus ?? new InMemoryEventBus();
  const idempotency = overrides.idempotency ?? new InMemoryIdempotencyStore();
  const resolver: WebhookSecretResolver = { resolve: async () => SECRET };
  const receiver = new WebhookReceiver({ bus, idempotency, secretResolver: resolver });
  return { receiver, bus, idempotency };
}

function buildPayload(overrides: Partial<{
  event_id: string;
  event_type: string;
  occurred_at: string;
  order_ref: string;
  session_ref: string;
}> = {}) {
  return JSON.stringify({
    event_id: overrides.event_id ?? "evt_001",
    event_type: overrides.event_type ?? "order.confirmed",
    occurred_at: overrides.occurred_at ?? "2026-06-07T10:00:00.000Z",
    order_ref: overrides.order_ref ?? "KAP-1",
    session_ref: overrides.session_ref ?? "sess-1",
  });
}

describe("signature verification", () => {
  it("accepts a valid HMAC-SHA256 signature", () => {
    const v = new HmacSha256Verifier();
    const body = buildPayload();
    expect(v.verify(body, { "x-kapruka-signature": sign(body) }, SECRET)).toBe(true);
  });

  it("rejects a missing signature header", () => {
    const v = new HmacSha256Verifier();
    expect(v.verify(buildPayload(), {}, SECRET)).toBe(false);
  });

  it("rejects a wrong signature", () => {
    const v = new HmacSha256Verifier();
    expect(v.verify(buildPayload(), { "x-kapruka-signature": "deadbeef" }, SECRET)).toBe(false);
  });

  it("rejects a signature computed with a different secret", () => {
    const v = new HmacSha256Verifier();
    const body = buildPayload();
    const wrong = createHmac("sha256", "OTHER").update(body, "utf8").digest("hex");
    expect(v.verify(body, { "x-kapruka-signature": wrong }, SECRET)).toBe(false);
  });

  it("enforces timestamp tolerance when configured", () => {
    const v = new HmacSha256Verifier({
      headerName: "x-kapruka-signature",
      timestampHeader: "x-kapruka-timestamp",
      timestampToleranceSec: 60,
      algorithm: "sha256",
      encoding: "hex",
    });
    const body = buildPayload();
    // timestamp header is in seconds (epoch convention)
    const headers = {
      "x-kapruka-signature": sign(body),
      "x-kapruka-timestamp": "1000",
    };
    // nowMs = 1_030_000 → drift = 30s, within 60s tolerance
    expect(v.verify(body, headers, SECRET, 1_030_000)).toBe(true);
    // nowMs = 5_000_000 → drift = 4000s, outside tolerance
    expect(v.verify(body, headers, SECRET, 5_000_000)).toBe(false);
  });
});

describe("WebhookReceiver — happy paths", () => {
  it("accepts an order.confirmed webhook and publishes a typed OrderEvent", async () => {
    const { receiver, bus } = buildReceiver();
    const seen: Event[] = [];
    bus.subscribe("order", (e) => void seen.push(e));

    const body = buildPayload();
    const result = await receiver.handle({
      tenantId: TENANT,
      rawBody: body,
      headers: { "x-kapruka-signature": sign(body) },
    });

    expect(result.status).toBe("accepted");
    expect(seen).toHaveLength(1);
    expect(seen[0]?.kind).toBe("order");
    if (seen[0]?.kind === "order") {
      expect(seen[0].status).toBe("confirmed");
      expect(seen[0].tenantId).toBe(TENANT);
      expect(seen[0].orderId).toBe("KAP-1");
      expect(seen[0].sessionId).toBe("sess-1");
    }
  });

  it("maps payment.succeeded onto a PaymentEvent", async () => {
    const { receiver, bus } = buildReceiver();
    const seen: Event[] = [];
    bus.subscribe("payment", (e) => void seen.push(e));

    const body = buildPayload({ event_id: "evt_pay", event_type: "payment.succeeded" });
    await receiver.handle({
      tenantId: TENANT,
      rawBody: body,
      headers: { "x-kapruka-signature": sign(body) },
    });

    expect(seen[0]?.kind).toBe("payment");
    if (seen[0]?.kind === "payment") expect(seen[0].status).toBe("succeeded");
  });

  it("maps fulfilment.delivered onto a FulfilmentEvent", async () => {
    const { receiver, bus } = buildReceiver();
    const seen: Event[] = [];
    bus.subscribe("fulfilment", (e) => void seen.push(e));

    const body = buildPayload({ event_id: "evt_ful", event_type: "fulfilment.delivered" });
    await receiver.handle({
      tenantId: TENANT,
      rawBody: body,
      headers: { "x-kapruka-signature": sign(body) },
    });

    expect(seen[0]?.kind).toBe("fulfilment");
    if (seen[0]?.kind === "fulfilment") expect(seen[0].status).toBe("delivered");
  });

  it("wildcard subscribers receive every published event", async () => {
    const { receiver, bus } = buildReceiver();
    const seen: Event[] = [];
    bus.subscribe("*", (e) => void seen.push(e));

    for (const t of ["order.created", "payment.initiated", "fulfilment.packed"]) {
      const body = buildPayload({ event_id: `evt_${t}`, event_type: t });
      await receiver.handle({
        tenantId: TENANT,
        rawBody: body,
        headers: { "x-kapruka-signature": sign(body) },
      });
    }
    expect(seen).toHaveLength(3);
  });
});

describe("WebhookReceiver — rejection paths", () => {
  it("rejects when no signing secret is resolved for the tenant", async () => {
    const bus = new InMemoryEventBus();
    const idempotency = new InMemoryIdempotencyStore();
    const receiver = new WebhookReceiver({
      bus,
      idempotency,
      secretResolver: { resolve: async () => null },
    });
    const body = buildPayload();
    const result = await receiver.handle({
      tenantId: TENANT,
      rawBody: body,
      headers: { "x-kapruka-signature": sign(body) },
    });
    expect(result.status).toBe("rejected");
    if (result.status === "rejected") expect(result.code).toBe("tenant");
  });

  it("rejects an invalid signature", async () => {
    const { receiver } = buildReceiver();
    const result = await receiver.handle({
      tenantId: TENANT,
      rawBody: buildPayload(),
      headers: { "x-kapruka-signature": "bad" },
    });
    expect(result.status).toBe("rejected");
    if (result.status === "rejected") expect(result.code).toBe("signature");
  });

  it("rejects malformed JSON", async () => {
    const { receiver } = buildReceiver();
    const body = "{not json";
    const result = await receiver.handle({
      tenantId: TENANT,
      rawBody: body,
      headers: { "x-kapruka-signature": sign(body) },
    });
    expect(result.status).toBe("rejected");
    if (result.status === "rejected") expect(result.code).toBe("payload");
  });

  it("rejects when event_id is missing", async () => {
    const { receiver } = buildReceiver();
    const body = JSON.stringify({
      event_type: "order.created",
      occurred_at: "2026-06-07T10:00:00.000Z",
      order_ref: "KAP-1",
      session_ref: "sess-1",
    });
    const result = await receiver.handle({
      tenantId: TENANT,
      rawBody: body,
      headers: { "x-kapruka-signature": sign(body) },
    });
    expect(result.status).toBe("rejected");
    if (result.status === "rejected") expect(result.code).toBe("no-event-id");
  });

  it("rejects an unsupported event_type", async () => {
    const { receiver } = buildReceiver();
    const body = buildPayload({ event_type: "weather.changed" });
    const result = await receiver.handle({
      tenantId: TENANT,
      rawBody: body,
      headers: { "x-kapruka-signature": sign(body) },
    });
    expect(result.status).toBe("rejected");
    if (result.status === "rejected") expect(result.code).toBe("unsupported");
  });

  it("rejects an order event with no session_ref", async () => {
    const { receiver } = buildReceiver();
    const body = JSON.stringify({
      event_id: "evt_x",
      event_type: "order.created",
      occurred_at: "2026-06-07T10:00:00.000Z",
      order_ref: "KAP-1",
    });
    const result = await receiver.handle({
      tenantId: TENANT,
      rawBody: body,
      headers: { "x-kapruka-signature": sign(body) },
    });
    expect(result.status).toBe("rejected");
    if (result.status === "rejected") expect(result.code).toBe("payload");
  });
});

describe("WebhookReceiver — idempotency", () => {
  let bus: InMemoryEventBus;
  let idempotency: InMemoryIdempotencyStore;
  let received: Event[];

  beforeEach(() => {
    bus = new InMemoryEventBus();
    idempotency = new InMemoryIdempotencyStore();
    received = [];
    bus.subscribe("*", (e) => void received.push(e));
  });

  it("a re-delivered webhook is reported as duplicate and not re-published", async () => {
    const { receiver } = buildReceiver({ bus, idempotency });
    const body = buildPayload();
    const first = await receiver.handle({
      tenantId: TENANT,
      rawBody: body,
      headers: { "x-kapruka-signature": sign(body) },
    });
    const second = await receiver.handle({
      tenantId: TENANT,
      rawBody: body,
      headers: { "x-kapruka-signature": sign(body) },
    });
    expect(first.status).toBe("accepted");
    expect(second.status).toBe("duplicate");
    if (second.status === "duplicate") expect(second.eventId).toBe("evt_001");
    expect(received).toHaveLength(1);
  });

  it("two tenants can share an event_id without collision", async () => {
    const otherTenant = TenantIdSchema.parse("other");
    const { receiver } = buildReceiver({ bus, idempotency });
    const body = buildPayload();
    const sig = { "x-kapruka-signature": sign(body) };

    const a = await receiver.handle({ tenantId: TENANT, rawBody: body, headers: sig });
    const b = await receiver.handle({ tenantId: otherTenant, rawBody: body, headers: sig });

    expect(a.status).toBe("accepted");
    expect(b.status).toBe("accepted");
    expect(received).toHaveLength(2);
  });
});

describe("WebhookReceiver — bus publish retry + reservation release", () => {
  it("retries a transient bus publish failure and ultimately publishes once", async () => {
    const bus = new InMemoryEventBus();
    const idempotency = new InMemoryIdempotencyStore();
    let attempts = 0;
    let lastEvent: Event | null = null;
    bus.subscribe("*", (e) => {
      attempts += 1;
      if (attempts < 3) throw new Error("transient");
      lastEvent = e;
    });

    const receiver = new WebhookReceiver({
      bus,
      idempotency,
      secretResolver: { resolve: async () => SECRET },
      retry: { maxAttempts: 5, baseDelayMs: 1, maxDelayMs: 4 },
    });

    const body = buildPayload();
    const out = await receiver.handle({
      tenantId: TENANT,
      rawBody: body,
      headers: { "x-kapruka-signature": sign(body) },
    });

    expect(out.status).toBe("accepted");
    expect(attempts).toBe(3);
    expect(lastEvent).not.toBeNull();
  });

  it("releases the idempotency reservation when publish ultimately fails so the next retry is reprocessed", async () => {
    const bus = new InMemoryEventBus();
    const idempotency = new InMemoryIdempotencyStore();
    let failedSoFar = 0;
    let successes = 0;
    bus.subscribe("*", () => {
      if (failedSoFar < 1) {
        failedSoFar += 1;
        throw new Error("hard fail");
      }
      successes += 1;
    });

    const receiver = new WebhookReceiver({
      bus,
      idempotency,
      secretResolver: { resolve: async () => SECRET },
      retry: { maxAttempts: 1, baseDelayMs: 1, maxDelayMs: 2 },
    });

    const body = buildPayload();
    const headers = { "x-kapruka-signature": sign(body) };

    // First delivery: the single attempt fails, propagates, releases the reservation.
    await expect(
      receiver.handle({ tenantId: TENANT, rawBody: body, headers }),
    ).rejects.toBeTruthy();
    expect(successes).toBe(0);

    // Retailer re-delivers. Because the reservation was released, this is reprocessed.
    const second = await receiver.handle({ tenantId: TENANT, rawBody: body, headers });
    expect(second.status).toBe("accepted");
    expect(successes).toBe(1);
  });
});

describe("InMemoryIdempotencyStore", () => {
  it("treats expired entries as available again", async () => {
    let now = 0;
    const clock = { now: () => now, sleep: async () => undefined };
    const store = new InMemoryIdempotencyStore({ clock, defaultTtlMs: 1_000 });
    expect(await store.tryReserve("k")).toBe(true);
    expect(await store.tryReserve("k")).toBe(false);
    now = 2_000;
    expect(await store.tryReserve("k")).toBe(true);
  });
});

// Sanity: KaprukaWebhookMapper has a useful extractEventId
it("KaprukaWebhookMapper.extractEventId works on a raw object", () => {
  const mapper = new KaprukaWebhookMapper();
  expect(mapper.extractEventId({ event_id: "x", event_type: "order.created" })).toBe("x");
  expect(mapper.extractEventId({ event_type: "order.created" })).toBeNull();
});

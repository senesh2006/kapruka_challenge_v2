import { describe, expect, it, vi } from "vitest";
import {
  CrossTenantAccessError,
  CustomerProfileSchema,
  EventSchema,
  OrderContextSchema,
  RecommendationSchema,
  SessionSchema,
  TenantIdSchema,
  TenantScope,
  TenantSchema,
  guardedList,
  guardedRead,
  guardedWrite,
} from "../src/index.js";

const A = TenantIdSchema.parse("tenant-a");
const B = TenantIdSchema.parse("tenant-b");

const now = "2026-06-05T10:00:00.000Z";

function buildTenant(id: string) {
  return TenantSchema.parse({
    id,
    name: id,
    enabledChannels: ["full-page"],
    persona: { brandVoice: "warm", languages: ["en"] },
    merchandising: {},
    guardrails: {},
    connectors: [{ kind: "catalogue", adapter: "kapruka-mcp", credentialRef: "k1" }],
    credentials: [],
    createdAt: now,
    updatedAt: now,
  });
}

function buildCustomer(tenantId: string) {
  return CustomerProfileSchema.parse({
    id: "cust-1",
    tenantId,
    consent: { memoryOptIn: true, marketingOptIn: false, capturedAt: now },
    createdAt: now,
    updatedAt: now,
  });
}

function buildSession(tenantId: string) {
  return SessionSchema.parse({
    id: "sess-1",
    tenantId,
    channel: "full-page",
    startedAt: now,
    lastTouchedAt: now,
  });
}

function buildRecommendation(tenantId: string) {
  return RecommendationSchema.parse({
    id: "rec-1",
    tenantId,
    sessionId: "sess-1",
    kind: "single",
    items: [
      {
        productId: "p-1",
        title: "Roses bouquet",
        imageUrl: "https://img.example.com/roses.jpg",
        price: { amount: 5500, currency: "LKR" },
        reason: "Her favourite",
      },
    ],
    rationale: "Anniversary classic",
    createdAt: now,
  });
}

function buildOrder(tenantId: string) {
  return OrderContextSchema.parse({
    id: "ord-1",
    tenantId,
    sessionId: "sess-1",
    sender: { name: "Sahan" },
    recipients: [{ name: "Amma", destination: { rawText: "Kandy" } }],
    lines: [{ productId: "p-1", quantity: 1, unitPrice: { amount: 5500, currency: "LKR" } }],
    currency: "LKR",
    total: { amount: 5500, currency: "LKR" },
    status: "draft",
    createdAt: now,
    updatedAt: now,
  });
}

function buildEvent(tenantId: string) {
  return EventSchema.parse({
    id: "evt-1",
    tenantId,
    kind: "conversation",
    sessionId: "sess-1",
    turnRole: "customer",
    contentLength: 42,
    at: now,
  });
}

describe("TenantScope.assertOwns", () => {
  it("returns the entity when tenantId matches", () => {
    const scope = new TenantScope(A);
    const session = buildSession(A);
    expect(scope.assertOwns(session)).toBe(session);
  });

  it("throws CrossTenantAccessError when tenantId differs", () => {
    const scope = new TenantScope(A);
    expect(() => scope.assertOwns(buildSession(B))).toThrow(CrossTenantAccessError);
  });

  it("attaches operation + expected + actual on the error", () => {
    const scope = new TenantScope(A);
    try {
      scope.assertOwns(buildSession(B), { operation: "write", entity: "Session" });
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(CrossTenantAccessError);
      const e = err as CrossTenantAccessError;
      expect(e.operation).toBe("write");
      expect(e.expectedTenantId).toBe(A);
      expect(e.actualTenantId).toBe(B);
      expect(e.entity).toBe("Session");
    }
  });
});

describe("TenantScope across every entity shape", () => {
  const scope = new TenantScope(A);

  it("refuses a foreign customer profile", () => {
    expect(() => scope.assertOwns(buildCustomer(B))).toThrow(CrossTenantAccessError);
    expect(scope.assertOwns(buildCustomer(A)).tenantId).toBe(A);
  });

  it("refuses a foreign recommendation", () => {
    expect(() => scope.assertOwns(buildRecommendation(B))).toThrow(CrossTenantAccessError);
    expect(scope.assertOwns(buildRecommendation(A)).tenantId).toBe(A);
  });

  it("refuses a foreign order context", () => {
    expect(() => scope.assertOwns(buildOrder(B))).toThrow(CrossTenantAccessError);
    expect(scope.assertOwns(buildOrder(A)).tenantId).toBe(A);
  });

  it("refuses a foreign event", () => {
    expect(() => scope.assertOwns(buildEvent(B))).toThrow(CrossTenantAccessError);
    expect(scope.assertOwns(buildEvent(A)).tenantId).toBe(A);
  });

  it("refuses a foreign Tenant on assertIsThisTenant", () => {
    expect(() => scope.assertIsThisTenant(buildTenant(B))).toThrow(CrossTenantAccessError);
    expect(scope.assertIsThisTenant(buildTenant(A)).id).toBe(A);
  });
});

describe("TenantScope.assertOwnsAll", () => {
  const scope = new TenantScope(A);

  it("passes a homogeneous list", () => {
    const list = [buildSession(A), buildSession(A)];
    expect(scope.assertOwnsAll(list)).toBe(list);
  });

  it("throws on the first foreign entity in a list", () => {
    const list = [buildSession(A), buildSession(B), buildSession(A)];
    expect(() => scope.assertOwnsAll(list)).toThrow(CrossTenantAccessError);
  });
});

describe("guarded async helpers", () => {
  const scope = new TenantScope(A);

  it("guardedRead returns null when fetcher returns null", async () => {
    const result = await guardedRead(scope, async () => null);
    expect(result).toBeNull();
  });

  it("guardedRead returns the entity when scoped correctly", async () => {
    const result = await guardedRead(scope, async () => buildOrder(A));
    expect(result?.tenantId).toBe(A);
  });

  it("guardedRead throws when fetcher returns a foreign entity", async () => {
    await expect(guardedRead(scope, async () => buildOrder(B))).rejects.toBeInstanceOf(
      CrossTenantAccessError,
    );
  });

  it("guardedList refuses lists containing foreign entities", async () => {
    await expect(
      guardedList(scope, async () => [buildOrder(A), buildOrder(B)]),
    ).rejects.toBeInstanceOf(CrossTenantAccessError);
  });

  it("guardedWrite refuses a payload with the wrong tenantId before calling the writer", async () => {
    const writer = vi.fn(async (x) => x);
    await expect(guardedWrite(scope, buildOrder(B), writer)).rejects.toBeInstanceOf(
      CrossTenantAccessError,
    );
    expect(writer).not.toHaveBeenCalled();
  });

  it("guardedWrite refuses a writer that returns a foreign entity", async () => {
    const payload = buildOrder(A);
    const writer = async () => buildOrder(B);
    await expect(guardedWrite(scope, payload, writer)).rejects.toBeInstanceOf(
      CrossTenantAccessError,
    );
  });

  it("guardedWrite passes through when both sides agree", async () => {
    const payload = buildOrder(A);
    const result = await guardedWrite(scope, payload, async (p) => p);
    expect(result.tenantId).toBe(A);
  });
});

describe("schema validation rejects bad shapes", () => {
  it("rejects a tenant with no enabled channels", () => {
    const result = TenantSchema.safeParse({
      id: "t",
      name: "t",
      enabledChannels: [],
      persona: { brandVoice: "x", languages: ["en"] },
      merchandising: {},
      guardrails: {},
      connectors: [{ kind: "catalogue", adapter: "a", credentialRef: "c" }],
      createdAt: now,
      updatedAt: now,
    });
    expect(result.success).toBe(false);
  });

  it("rejects a recommendation with empty items", () => {
    const result = RecommendationSchema.safeParse({
      id: "r",
      tenantId: "t",
      sessionId: "s",
      kind: "single",
      items: [],
      rationale: "n/a",
      createdAt: now,
    });
    expect(result.success).toBe(false);
  });
});

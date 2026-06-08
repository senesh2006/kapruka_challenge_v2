import { describe, expect, it, vi } from "vitest";
import {
  CrossTenantAccessError,
  CustomerProfileSchema,
  SessionSchema,
  TenantIdSchema,
  TenantScope,
  TenantSchema,
  type CustomerProfile,
  type Session,
  type Tenant,
} from "@sevana/shared";
import {
  BlobAdapterOutageError,
  BlobIdempotencyStore,
  CustomerProfileRepository,
  EventRepository,
  FaultInjectableBlobAdapter,
  InMemoryBlobAdapter,
  SessionRepository,
  STORAGE_PACKAGE,
  StorageRetentionAgent,
  TenantRepository,
  VercelBlobAdapter,
} from "../src/index.js";

const NOW = "2026-06-07T10:00:00.000Z";

function buildTenant(id = "kapruka"): Tenant {
  return TenantSchema.parse({
    id,
    name: id,
    enabledChannels: ["full-page"],
    persona: { brandVoice: "Hari", languages: ["en"] },
    merchandising: {},
    guardrails: {},
    connectors: [{ kind: "catalogue", adapter: "kapruka", credentialRef: "k" }],
    credentials: [{ ref: "k", connectorKind: "catalogue", scopes: [] }],
    createdAt: NOW,
    updatedAt: NOW,
  });
}

function buildSession(tenantId: string, id = "sess-1"): Session {
  return SessionSchema.parse({
    id,
    tenantId,
    channel: "full-page",
    startedAt: NOW,
    lastTouchedAt: NOW,
  });
}

function buildProfile(tenantId: string, id = "cust-1"): CustomerProfile {
  return CustomerProfileSchema.parse({
    id,
    tenantId,
    consent: { memoryOptIn: true, marketingOptIn: false, capturedAt: NOW },
    createdAt: NOW,
    updatedAt: NOW,
  });
}

describe("package marker", () => {
  it("exposes its package id", () => {
    expect(STORAGE_PACKAGE).toBe("@sevana/storage");
  });
});

describe("TenantRepository", () => {
  it("round-trips a tenant by id", async () => {
    const adapter = new InMemoryBlobAdapter();
    const repo = new TenantRepository(adapter);
    await repo.put(buildTenant("kapruka"));
    const back = await repo.get(TenantIdSchema.parse("kapruka"));
    expect(back?.name).toBe("kapruka");
  });

  it("lists every tenant", async () => {
    const adapter = new InMemoryBlobAdapter();
    const repo = new TenantRepository(adapter);
    await repo.put(buildTenant("kapruka"));
    await repo.put(buildTenant("acme"));
    const tenants = await repo.list();
    expect(tenants.map((t) => String(t.id)).sort()).toEqual(["acme", "kapruka"]);
  });
});

describe("BlobBackedStore — tenant isolation in the paths AND at the application layer", () => {
  it("writes blobs under tenant-scoped pathnames", async () => {
    const adapter = new InMemoryBlobAdapter();
    const repo = new SessionRepository(adapter);
    const scope = new TenantScope(TenantIdSchema.parse("kapruka"));
    await repo.upsert(buildSession("kapruka"), scope);
    const paths = await adapter.list("sessions/");
    expect(paths).toEqual(["sessions/kapruka/sess-1.json"]);
  });

  it("refuses to write an entity whose tenantId disagrees with the scope", async () => {
    const adapter = new InMemoryBlobAdapter();
    const repo = new SessionRepository(adapter);
    const scope = new TenantScope(TenantIdSchema.parse("kapruka"));
    await expect(repo.upsert(buildSession("other-tenant"), scope)).rejects.toBeInstanceOf(
      CrossTenantAccessError,
    );
  });

  it("scope.list returns only this tenant's entries", async () => {
    const adapter = new InMemoryBlobAdapter();
    const repo = new SessionRepository(adapter);
    const kap = new TenantScope(TenantIdSchema.parse("kapruka"));
    const acme = new TenantScope(TenantIdSchema.parse("acme"));
    await repo.upsert(buildSession("kapruka", "s-1"), kap);
    await repo.upsert(buildSession("kapruka", "s-2"), kap);
    await repo.upsert(buildSession("acme", "s-3"), acme);
    const kapList = await repo.list(kap);
    expect(kapList.map((s) => String(s.id)).sort()).toEqual(["s-1", "s-2"]);
  });

  it("get returns null when the entry is absent", async () => {
    const adapter = new InMemoryBlobAdapter();
    const repo = new SessionRepository(adapter);
    const scope = new TenantScope(TenantIdSchema.parse("kapruka"));
    expect(await repo.get("missing" as never, scope)).toBeNull();
  });

  it("delete drops the entry", async () => {
    const adapter = new InMemoryBlobAdapter();
    const repo = new SessionRepository(adapter);
    const scope = new TenantScope(TenantIdSchema.parse("kapruka"));
    await repo.upsert(buildSession("kapruka"), scope);
    expect(adapter.size()).toBe(1);
    await repo.delete("sess-1" as never, scope);
    expect(adapter.size()).toBe(0);
  });
});

describe("CustomerProfileRepository — customer controls (FR-14)", () => {
  it("supports view + edit + delete affordances", async () => {
    const adapter = new InMemoryBlobAdapter();
    const repo = new CustomerProfileRepository(adapter);
    const scope = new TenantScope(TenantIdSchema.parse("kapruka"));
    const profile = buildProfile("kapruka");
    await repo.upsert(profile, scope);
    const fetched = await repo.get("cust-1" as never, scope);
    expect(fetched?.consent.memoryOptIn).toBe(true);

    const edited = CustomerProfileSchema.parse({
      ...profile,
      preferences: { colours: ["yellow"], styles: [], dislikes: [], cuisines: [] },
      updatedAt: NOW,
    });
    await repo.upsert(edited, scope);
    expect((await repo.get("cust-1" as never, scope))?.preferences.colours).toEqual(["yellow"]);

    await repo.delete("cust-1" as never, scope);
    expect(await repo.get("cust-1" as never, scope)).toBeNull();
  });
});

describe("EventRepository — append-only log", () => {
  it("appends and re-reads events scoped to a tenant", async () => {
    const adapter = new InMemoryBlobAdapter();
    const repo = new EventRepository(adapter);
    const scope = new TenantScope(TenantIdSchema.parse("kapruka"));
    await repo.append(
      {
        kind: "order",
        id: "evt-1",
        tenantId: "kapruka" as never,
        sessionId: "sess-1" as never,
        orderId: "KAP-1" as never,
        status: "created",
        at: NOW,
      },
      scope,
    );
    const list = await repo.list(scope);
    expect(list).toHaveLength(1);
    expect(list[0]?.kind).toBe("order");
  });
});

describe("BlobIdempotencyStore", () => {
  it("tryReserve returns true once then false for the same key", async () => {
    const adapter = new InMemoryBlobAdapter();
    const store = new BlobIdempotencyStore({ adapter, clock: () => 0 });
    expect(await store.tryReserve("k1")).toBe(true);
    expect(await store.tryReserve("k1")).toBe(false);
  });

  it("treats expired entries as available again", async () => {
    let now = 0;
    const adapter = new InMemoryBlobAdapter();
    const store = new BlobIdempotencyStore({ adapter, clock: () => now, defaultTtlMs: 1_000 });
    expect(await store.tryReserve("k")).toBe(true);
    now = 2_000;
    expect(await store.tryReserve("k")).toBe(true);
  });

  it("release drops the reservation so the next caller can take it", async () => {
    const adapter = new InMemoryBlobAdapter();
    const store = new BlobIdempotencyStore({ adapter, clock: () => 0 });
    expect(await store.tryReserve("k")).toBe(true);
    await store.release("k");
    expect(await store.tryReserve("k")).toBe(true);
  });
});

describe("StorageRetentionAgent — consent-gated update (PRD §8)", () => {
  it("returns null when the session has no customerId", async () => {
    const repo = new CustomerProfileRepository(new InMemoryBlobAdapter());
    const agent = new StorageRetentionAgent(repo);
    const result = await agent.load({
      session: buildSession("kapruka"),
      tenant: buildTenant("kapruka"),
    });
    expect(result).toBeNull();
  });

  it("does not persist when memoryOptIn is false", async () => {
    const adapter = new InMemoryBlobAdapter();
    const repo = new CustomerProfileRepository(adapter);
    const agent = new StorageRetentionAgent(repo);
    const tenant = buildTenant("kapruka");
    const noConsent: CustomerProfile = {
      ...buildProfile("kapruka"),
      consent: { memoryOptIn: false, marketingOptIn: false, capturedAt: NOW },
    };
    const session = SessionSchema.parse({
      ...buildSession("kapruka"),
      customerId: "cust-1",
    });
    await agent.update({ session, plan: {} as never, profile: noConsent });
    expect(await adapter.list("customers/")).toHaveLength(0);
  });

  it("persists when memoryOptIn is true and bumps updatedAt", async () => {
    const adapter = new InMemoryBlobAdapter();
    const repo = new CustomerProfileRepository(adapter);
    const agent = new StorageRetentionAgent(repo);
    const tenant = buildTenant("kapruka");
    const profile = buildProfile("kapruka");
    const session = SessionSchema.parse({
      ...buildSession("kapruka"),
      customerId: "cust-1",
    });
    await agent.update({ session, plan: {} as never, profile });
    const scope = new TenantScope(tenant.id);
    const stored = await repo.get("cust-1" as never, scope);
    expect(stored).not.toBeNull();
    expect(stored?.updatedAt).not.toBe(NOW);
  });
});

describe("FaultInjectableBlobAdapter (chaos)", () => {
  it("setOutage(true) makes every call throw BlobAdapterOutageError without touching the inner adapter", async () => {
    const inner = new InMemoryBlobAdapter();
    await inner.put("a", "1");
    const adapter = new FaultInjectableBlobAdapter({ inner, outage: true });
    await expect(adapter.get("a")).rejects.toBeInstanceOf(BlobAdapterOutageError);
    await expect(adapter.put("b", "2")).rejects.toBeInstanceOf(BlobAdapterOutageError);
    expect(inner.size()).toBe(1); // the put on b was blocked
  });

  it("setFailNext(n) fails the next n calls then recovers", async () => {
    const inner = new InMemoryBlobAdapter();
    const adapter = new FaultInjectableBlobAdapter({ inner, failNext: 2 });
    await expect(adapter.put("a", "1")).rejects.toBeInstanceOf(BlobAdapterOutageError);
    await expect(adapter.put("b", "2")).rejects.toBeInstanceOf(BlobAdapterOutageError);
    await adapter.put("c", "3");
    expect(await adapter.get("c")).toBe("3");
  });

  it("toggling outage off restores normal behaviour", async () => {
    const inner = new InMemoryBlobAdapter();
    const adapter = new FaultInjectableBlobAdapter({ inner });
    adapter.setOutage(true);
    await expect(adapter.put("x", "1")).rejects.toBeInstanceOf(BlobAdapterOutageError);
    adapter.setOutage(false);
    await adapter.put("x", "1");
    expect(await adapter.get("x")).toBe("1");
  });
});

describe("VercelBlobAdapter — wire shape against an injected blob module", () => {
  it("put/get/list/delete delegate to the injected @vercel/blob module", async () => {
    const stored = new Map<string, string>();
    const blob = {
      put: vi.fn(async (pathname: string, body: string) => {
        stored.set(pathname, body);
        return { url: `https://blob.example.com/${pathname}`, pathname };
      }),
      head: vi.fn(async (pathname: string) => {
        if (!stored.has(pathname)) throw new Error("blob not found");
        return { url: `https://blob.example.com/${pathname}` };
      }),
      list: vi.fn(async ({ prefix }: { prefix?: string }) => ({
        blobs: [...stored.keys()]
          .filter((k) => !prefix || k.startsWith(prefix))
          .map((pathname) => ({ pathname, url: `https://blob.example.com/${pathname}` })),
      })),
      del: vi.fn(async (pathname: string | string[]) => {
        const paths = Array.isArray(pathname) ? pathname : [pathname];
        for (const p of paths) stored.delete(p);
      }),
    };
    const fetcher = vi.fn(async (url: string) => {
      const pathname = url.replace("https://blob.example.com/", "");
      const body = stored.get(pathname);
      return new Response(body, { status: body ? 200 : 404 });
    }) as unknown as typeof fetch;

    const adapter = new VercelBlobAdapter({
      vercelBlob: blob,
      fetcher,
      token: "test-token",
    });
    await adapter.put("a/b.json", JSON.stringify({ hello: "world" }));
    const read = await adapter.get("a/b.json");
    expect(read).toBe(JSON.stringify({ hello: "world" }));
    expect(blob.put).toHaveBeenCalledWith("a/b.json", JSON.stringify({ hello: "world" }), expect.objectContaining({
      access: "public",
      addRandomSuffix: false,
      allowOverwrite: true,
      token: "test-token",
    }));

    const list = await adapter.list("a/");
    expect([...list]).toEqual(["a/b.json"]);

    await adapter.delete("a/b.json");
    expect(await adapter.get("a/b.json")).toBeNull();
  });
});

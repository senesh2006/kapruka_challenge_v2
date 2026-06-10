import { describe, expect, it, vi } from "vitest";
import {
  ChannelClient,
  ChannelClientError,
  FULL_PAGE_CHANNEL,
  InMemorySessionStore,
  MESSAGING_CHANNEL,
  MOBILE_SDK_CHANNEL,
  WIDGET_CHANNEL,
  newSessionId,
  type TurnResponse,
} from "../src/index.js";

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  });
}

const sampleResponse: TurnResponse = {
  sessionId: "s-test",
  reply: "Hari: here's what I'd recommend.",
  cardRefs: ["kap-cake-1"],
  cards: [],
  guardrailVerdict: "approved",
  detectedLocale: "en",
  at: "2026-06-07T10:00:00.000Z",
};

describe("Channel identifiers", () => {
  it("expose the four PRD-named channels", () => {
    expect([WIDGET_CHANNEL, FULL_PAGE_CHANNEL, MOBILE_SDK_CHANNEL, MESSAGING_CHANNEL]).toEqual([
      "widget",
      "full-page",
      "mobile-sdk",
      "messaging-whatsapp",
    ]);
  });
});

describe("newSessionId", () => {
  it("returns a non-empty string each time, unique across calls", () => {
    const a = newSessionId();
    const b = newSessionId();
    expect(a).not.toBe(b);
    expect(a.startsWith("s-")).toBe(true);
  });
});

describe("InMemorySessionStore", () => {
  it("get / set / clear roundtrip", () => {
    const s = new InMemorySessionStore();
    expect(s.get()).toBeNull();
    s.set("x");
    expect(s.get()).toBe("x");
    s.clear();
    expect(s.get()).toBeNull();
  });
});

describe("ChannelClient.sendTurn", () => {
  it("creates a session, posts JSON, and parses the response", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(sampleResponse));
    const store = new InMemorySessionStore();
    const client = new ChannelClient({
      endpoint: "https://api.example.com/turn",
      sessionStore: store,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      tenantId: "kapruka",
    });
    const result = await client.sendTurn("Birthday cake for amma in Galle");
    expect(result.reply).toContain("recommend");

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://api.example.com/turn");
    expect(init?.method).toBe("POST");
    const body = JSON.parse(init?.body as string) as { sessionId: string; message: string };
    expect(body.message).toBe("Birthday cake for amma in Galle");
    expect(body.sessionId).toBe(store.get());
    const headers = init?.headers as Record<string, string>;
    expect(headers["x-sevana-channel"]).toBe("full-page");
    expect(headers["x-tenant-id"]).toBe("kapruka");
  });

  it("reuses the same session id across calls (session continuity)", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(sampleResponse));
    const client = new ChannelClient({
      sessionStore: new InMemorySessionStore(),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await client.sendTurn("first");
    await client.sendTurn("second");
    const firstBody = JSON.parse((fetchImpl.mock.calls[0]?.[1]?.body as string) ?? "{}");
    const secondBody = JSON.parse((fetchImpl.mock.calls[1]?.[1]?.body as string) ?? "{}");
    expect(firstBody.sessionId).toBe(secondBody.sessionId);
  });

  it("resetSession drops the id so the next call starts fresh", async () => {
    const store = new InMemorySessionStore();
    const fetchImpl = vi.fn(async () => jsonResponse(sampleResponse));
    const client = new ChannelClient({
      sessionStore: store,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await client.sendTurn("first");
    const before = store.get();
    const fresh = await client.resetSession();
    expect(fresh).not.toBe(before);
  });

  it("throws ChannelClientError on a non-2xx with the body attached", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: "bad" }, { status: 400 }));
    const client = new ChannelClient({
      sessionStore: new InMemorySessionStore(),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(client.sendTurn("x")).rejects.toBeInstanceOf(ChannelClientError);
    try {
      await client.sendTurn("y");
    } catch (err) {
      const e = err as ChannelClientError;
      expect(e.status).toBe(400);
      expect((e.body as { error: string }).error).toBe("bad");
    }
  });

  it("rejects an empty message before hitting the network", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(sampleResponse));
    const client = new ChannelClient({
      sessionStore: new InMemorySessionStore(),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(client.sendTurn("   ")).rejects.toBeInstanceOf(ChannelClientError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("validates the response shape with Zod and rejects garbage", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ not: "a turn response" }));
    const client = new ChannelClient({
      sessionStore: new InMemorySessionStore(),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(client.sendTurn("x")).rejects.toBeTruthy();
  });
});

import { describe, expect, it, vi } from "vitest";
import {
  AsyncStorageSessionStore,
  createMobileChannelClient,
  mapTurnToMessages,
  MESSAGING_CHANNEL,
  MOBILE_SDK_CHANNEL,
  StubMessagingProvider,
  type AsyncStorageLike,
  type IncomingMessage,
  type TurnResponse,
} from "../src/index.js";

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  });
}

function memoryAsyncStorage(): AsyncStorageLike {
  const map = new Map<string, string>();
  return {
    async getItem(k) {
      return map.get(k) ?? null;
    },
    async setItem(k, v) {
      map.set(k, v);
    },
    async removeItem(k) {
      map.delete(k);
    },
  };
}

const turnResponse: TurnResponse = {
  sessionId: "s-1",
  reply: "Aiyo, for amma's birthday I'd pair the kiri-bath cake with sunflowers — both deliverable to Galle.",
  cardRefs: ["kap-cake-1", "kap-flowers-1"],
  cards: [
    {
      productId: "kap-cake-1",
      title: "Kiri-bath cake 500g",
      imageUrl: "https://img.kapruka.test/cake-flat.jpg",
      renderUrl: "https://placehold.co/480x600/png?text=cake&id=kap-cake-1",
      price: { amount: 2400, currency: "LKR" },
      reason: "Her favourite — kiri-bath",
      isHero: true,
    },
    {
      productId: "kap-flowers-1",
      title: "Sunflower bouquet",
      imageUrl: "https://img.kapruka.test/flowers-flat.jpg",
      price: { amount: 3000, currency: "LKR" },
      reason: "Yellow flowers — her colour",
    },
  ],
  guardrailVerdict: "approved",
  detectedLocale: "tanglish",
  at: "2026-06-07T10:00:00.000Z",
};

// ============================================================================
// Mobile SDK
// ============================================================================

describe("AsyncStorageSessionStore", () => {
  it("round-trips through AsyncStorage", async () => {
    const storage = memoryAsyncStorage();
    const store = new AsyncStorageSessionStore(storage);
    expect(await store.get()).toBeNull();
    await store.set("s-rn-1");
    expect(await store.get()).toBe("s-rn-1");
    await store.clear();
    expect(await store.get()).toBeNull();
  });

  it("swallows storage errors so a flaky disk doesn't break the chat", async () => {
    const flaky: AsyncStorageLike = {
      async getItem() {
        throw new Error("RN AsyncStorage went pop");
      },
      async setItem() {
        throw new Error("write failed");
      },
      async removeItem() {
        throw new Error("delete failed");
      },
    };
    const store = new AsyncStorageSessionStore(flaky);
    expect(await store.get()).toBeNull();
    await expect(store.set("x")).resolves.toBeUndefined();
    await expect(store.clear()).resolves.toBeUndefined();
  });

  it("honours a custom storage key", async () => {
    const storage = memoryAsyncStorage();
    const store = new AsyncStorageSessionStore(storage, { storageKey: "custom.key" });
    await store.set("s-custom");
    expect(await storage.getItem("custom.key")).toBe("s-custom");
  });
});

describe("createMobileChannelClient", () => {
  it("wires AsyncStorage + channel=mobile-sdk and posts the session id through", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(turnResponse));
    const storage = memoryAsyncStorage();
    const client = createMobileChannelClient({
      storage,
      endpoint: "https://api.example.com/turn",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      tenantId: "kapruka",
    });

    expect(client.channelKind()).toBe(MOBILE_SDK_CHANNEL);

    const result = await client.sendTurn("Amma's birthday eka");
    expect(result.cards[0]?.title).toBe("Kiri-bath cake 500g");

    const [, init] = fetchImpl.mock.calls[0]!;
    const body = JSON.parse(init?.body as string) as { sessionId: string };
    expect(body.sessionId).toMatch(/^s-/);
    expect(await storage.getItem("sevana.sessionId")).toBe(body.sessionId);
    expect((init?.headers as Record<string, string>)["x-sevana-channel"]).toBe("mobile-sdk");
  });

  it("survives an app restart — a second client wired to the same AsyncStorage continues the session", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(turnResponse));
    const storage = memoryAsyncStorage();
    const first = createMobileChannelClient({
      storage,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await first.sendTurn("hello");
    const persistedId = await storage.getItem("sevana.sessionId");
    expect(persistedId).toBeTruthy();

    // Simulate app restart: brand new client, same storage backend.
    const second = createMobileChannelClient({
      storage,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const id = await second.ensureSessionId();
    expect(id).toBe(persistedId);
  });
});

// ============================================================================
// Messaging — WhatsApp-style mapping
// ============================================================================

describe("mapTurnToMessages — WhatsApp-style", () => {
  it("emits one text message with the reply followed by up to N image cards", () => {
    const messages = mapTurnToMessages(turnResponse);
    expect(messages[0]).toEqual({ type: "text", text: turnResponse.reply });
    expect(messages[1]).toEqual(
      expect.objectContaining({
        type: "image",
        url: "https://placehold.co/480x600/png?text=cake&id=kap-cake-1",
      }),
    );
    expect((messages[1] as { caption: string }).caption).toContain("Kiri-bath cake 500g");
    expect((messages[1] as { caption: string }).caption).toContain("2,400");
    expect(messages[2]).toEqual(
      expect.objectContaining({
        type: "image",
        url: "https://img.kapruka.test/flowers-flat.jpg",
      }),
    );
  });

  it("honours maxCards to keep the message count under the channel's limit", () => {
    const messages = mapTurnToMessages(turnResponse, { maxCards: 1 });
    expect(messages.filter((m) => m.type === "image")).toHaveLength(1);
  });

  it("emits interactive buttons under the cards when requested", () => {
    const messages = mapTurnToMessages(turnResponse, { includeButtons: true });
    const buttons = messages.find((m) => m.type === "interactive-buttons");
    expect(buttons).toBeDefined();
    if (buttons && buttons.type === "interactive-buttons") {
      expect(buttons.buttons.map((b) => b.id)).toEqual(["confirm", "more", "human"]);
    }
  });

  it("truncates a long reply to the channel cap so providers don't reject", () => {
    const long = "x".repeat(2_000);
    const messages = mapTurnToMessages({ ...turnResponse, reply: long });
    const first = messages[0]!;
    if (first.type === "text") {
      expect(first.text.length).toBeLessThanOrEqual(1024);
      expect(first.text.endsWith("…")).toBe(true);
    }
  });

  it("prefers the on-model renderUrl when present, falling back to imageUrl", () => {
    const messages = mapTurnToMessages(turnResponse, { maxCards: 2 });
    const hero = messages[1] as { url: string };
    expect(hero.url).toBe("https://placehold.co/480x600/png?text=cake&id=kap-cake-1");
    const second = messages[2] as { url: string };
    expect(second.url).toBe("https://img.kapruka.test/flowers-flat.jpg");
  });

  it("the message channel name is the documented WhatsApp identifier", () => {
    expect(MESSAGING_CHANNEL).toBe("messaging-whatsapp");
  });
});

// ============================================================================
// StubMessagingProvider — capture sends + fan out incoming
// ============================================================================

describe("StubMessagingProvider", () => {
  it("captures every send call for assertions", async () => {
    const provider = new StubMessagingProvider();
    await provider.send("+94771234567", [{ type: "text", text: "hello" }]);
    await provider.send("+94771234567", [{ type: "text", text: "follow-up" }]);
    expect(provider.sent).toHaveLength(2);
    expect(provider.sent[0]?.to).toBe("+94771234567");
  });

  it("fans deliverIncoming out to every subscribed handler", async () => {
    const provider = new StubMessagingProvider();
    const received: IncomingMessage[] = [];
    const off = provider.onIncoming((m) => void received.push(m));
    await provider.deliverIncoming({
      from: "+94771234567",
      tenantId: "kapruka",
      text: "Amma's birthday",
      at: "2026-06-07T10:00:00.000Z",
    });
    expect(received).toHaveLength(1);
    expect(received[0]?.text).toBe("Amma's birthday");
    off();
    await provider.deliverIncoming({
      from: "+94771234567",
      tenantId: "kapruka",
      text: "ignored",
      at: "2026-06-07T10:00:00.000Z",
    });
    expect(received).toHaveLength(1);
  });
});

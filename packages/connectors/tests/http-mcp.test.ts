import { describe, expect, it, vi } from "vitest";
import { HttpMcpClient, HttpMcpClientError } from "../src/index.js";

function jsonResponse(body: unknown, status = 200, contentType = "application/json"): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": contentType },
  });
}

function jsonResponseWithSession(body: unknown, sessionId: string, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "mcp-session-id": sessionId,
    },
  });
}

// ============================================================================
// MCP Streamable HTTP handshake (initialize + Mcp-Session-Id)
// ============================================================================

describe("HttpMcpClient — MCP Streamable HTTP handshake", () => {
  it("performs initialize → notifications/initialized → tools/call on first use", async () => {
    let call = 0;
    const fetchImpl = vi.fn(async (_url, init?: RequestInit) => {
      call += 1;
      const body = JSON.parse((init!.body as string) ?? "{}");
      if (call === 1) {
        // initialize — server hands back a session id
        expect(body.method).toBe("initialize");
        expect(body.params.protocolVersion).toBeDefined();
        expect(body.params.clientInfo).toEqual({ name: "sevana-hari", version: "1.0.0" });
        return jsonResponseWithSession(
          { jsonrpc: "2.0", id: body.id, result: { protocolVersion: "2025-03-26" } },
          "sess-abc",
        );
      }
      if (call === 2) {
        expect(body.method).toBe("notifications/initialized");
        return new Response(null, { status: 202 });
      }
      // tools/call carries the session id from initialize
      expect(body.method).toBe("tools/call");
      expect((init!.headers as Record<string, string>)["mcp-session-id"]).toBe("sess-abc");
      return jsonResponse({
        jsonrpc: "2.0",
        id: body.id,
        result: { structuredContent: { items: [] } },
      });
    });
    const client = new HttpMcpClient({
      baseUrl: "https://mcp.kapruka.com",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await client.callTool("kapruka_search_products", { query: "hello", limit: 5 });
    expect(call).toBe(3);
  });

  it("reuses the session id across subsequent tool calls (handshake happens once)", async () => {
    let call = 0;
    let initCalls = 0;
    const fetchImpl = vi.fn(async (_url, init?: RequestInit) => {
      call += 1;
      const body = JSON.parse((init!.body as string) ?? "{}");
      if (body.method === "initialize") {
        initCalls += 1;
        return jsonResponseWithSession(
          { jsonrpc: "2.0", id: body.id, result: {} },
          "sess-xyz",
        );
      }
      if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
      // tools/call
      expect((init!.headers as Record<string, string>)["mcp-session-id"]).toBe("sess-xyz");
      return jsonResponse({ jsonrpc: "2.0", id: body.id, result: { structuredContent: {} } });
    });
    const client = new HttpMcpClient({
      baseUrl: "https://mcp.example.com",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await client.callTool("a", {});
    await client.callTool("b", {});
    await client.callTool("c", {});

    expect(initCalls).toBe(1);
    // 1 init + 1 notify + 3 tool calls = 5
    expect(call).toBe(5);
  });

  it("concurrent first calls share a single handshake (de-duplicated)", async () => {
    let initCalls = 0;
    const fetchImpl = vi.fn(async (_url, init?: RequestInit) => {
      const body = JSON.parse((init!.body as string) ?? "{}");
      if (body.method === "initialize") {
        initCalls += 1;
        await new Promise((r) => setTimeout(r, 10));
        return jsonResponseWithSession({ jsonrpc: "2.0", id: body.id, result: {} }, "sess-1");
      }
      if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
      return jsonResponse({ jsonrpc: "2.0", id: body.id, result: { structuredContent: {} } });
    });
    const client = new HttpMcpClient({
      baseUrl: "https://mcp.example.com",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await Promise.all([client.callTool("a", {}), client.callTool("b", {}), client.callTool("c", {})]);
    expect(initCalls).toBe(1);
  });

  it("re-handshakes once when the server returns a session error, then retries the tool call", async () => {
    let initCalls = 0;
    let toolCallAttempts = 0;
    let currentSession = "sess-old";
    const fetchImpl = vi.fn(async (_url, init?: RequestInit) => {
      const body = JSON.parse((init!.body as string) ?? "{}");
      if (body.method === "initialize") {
        initCalls += 1;
        // Second handshake hands out a fresh id.
        currentSession = initCalls === 1 ? "sess-old" : "sess-new";
        return jsonResponseWithSession({ jsonrpc: "2.0", id: body.id, result: {} }, currentSession);
      }
      if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
      // tools/call: first attempt complains the session is missing/expired,
      // second attempt (after re-handshake) succeeds.
      toolCallAttempts += 1;
      if (toolCallAttempts === 1) {
        return jsonResponse(
          {
            jsonrpc: "2.0",
            id: "server-error",
            error: { code: -32600, message: "Bad Request: Missing session ID" },
          },
          400,
        );
      }
      expect((init!.headers as Record<string, string>)["mcp-session-id"]).toBe("sess-new");
      return jsonResponse({
        jsonrpc: "2.0",
        id: body.id,
        result: { structuredContent: { ok: true } },
      });
    });
    const client = new HttpMcpClient({
      baseUrl: "https://mcp.example.com",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const out = await client.callTool<{ ok: boolean }>("kapruka_search_products", {});
    expect(out.ok).toBe(true);
    expect(initCalls).toBe(2);
    expect(toolCallAttempts).toBe(2);
  });

  it("skipHandshake disables the initialize step entirely", async () => {
    let call = 0;
    const fetchImpl = vi.fn(async (_url, init?: RequestInit) => {
      call += 1;
      const body = JSON.parse((init!.body as string) ?? "{}");
      expect(body.method).toBe("tools/call");
      return jsonResponse({ jsonrpc: "2.0", id: body.id, result: { structuredContent: {} } });
    });
    const client = new HttpMcpClient({
      baseUrl: "https://mcp.example.com",
      skipHandshake: true,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await client.callTool("x", {});
    expect(call).toBe(1);
  });

  it("propagates a handshake-time error from the server", async () => {
    const fetchImpl = vi.fn(async (_url, init?: RequestInit) => {
      const body = JSON.parse((init!.body as string) ?? "{}");
      if (body.method === "initialize") {
        return jsonResponse({
          jsonrpc: "2.0",
          id: body.id,
          error: { code: -32602, message: "unsupported protocolVersion" },
        });
      }
      return jsonResponse({});
    });
    const client = new HttpMcpClient({
      baseUrl: "https://mcp.example.com",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(client.callTool("x", {})).rejects.toThrow(/initialize failed/i);
  });
});

// ============================================================================
// JSON-RPC mode wire-format (handshake skipped — pin the tools/call shape)
// ============================================================================

describe("HttpMcpClient — jsonrpc wire format", () => {
  it("POSTs JSON-RPC tools/call to the base URL with bearer auth", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        jsonrpc: "2.0",
        id: 1,
        result: { structuredContent: { results: [] } },
      }),
    );
    const client = new HttpMcpClient({
      baseUrl: "https://mcp.kapruka.com/",
      apiKey: "sk-kap",
      skipHandshake: true,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await client.callTool("kapruka_search_products", { query: "roses", limit: 5 });

    const [url, init] = fetchImpl.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe("https://mcp.kapruka.com");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer sk-kap");
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      jsonrpc: "2.0",
      method: "tools/call",
      params: { name: "kapruka_search_products", arguments: { query: "roses", limit: 5 } },
    });
  });

  it("honours a custom rpcPath", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ jsonrpc: "2.0", id: 1, result: { structuredContent: {} } }),
    );
    const client = new HttpMcpClient({
      baseUrl: "https://mcp.kapruka.com",
      rpcPath: "/mcp",
      skipHandshake: true,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await client.callTool("x", {});
    expect((fetchImpl.mock.calls[0]! as [string, RequestInit])[0]).toBe("https://mcp.kapruka.com/mcp");
  });

  it("extracts result.structuredContent", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ jsonrpc: "2.0", id: 1, result: { structuredContent: { results: [{ id: 1 }] } } }),
    );
    const client = new HttpMcpClient({
      baseUrl: "https://mcp.example.com",
      skipHandshake: true,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const out = await client.callTool<{ results: unknown[] }>("x", {});
    expect(out.results).toHaveLength(1);
  });

  it("JSON-parses the first text content block when there is no structuredContent", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        jsonrpc: "2.0",
        id: 1,
        result: { content: [{ type: "text", text: JSON.stringify({ results: [{ id: 7 }] }) }] },
      }),
    );
    const client = new HttpMcpClient({
      baseUrl: "https://mcp.example.com",
      skipHandshake: true,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const out = await client.callTool<{ results: Array<{ id: number }> }>("x", {});
    expect(out.results[0]?.id).toBe(7);
  });

  it("parses an SSE-framed response body", async () => {
    const sse =
      "event: message\n" +
      `data: ${JSON.stringify({ jsonrpc: "2.0", id: 1, result: { structuredContent: { ok: true } } })}\n\n`;
    const fetchImpl = vi.fn(
      async () => new Response(sse, { status: 200, headers: { "content-type": "text/event-stream" } }),
    );
    const client = new HttpMcpClient({
      baseUrl: "https://mcp.example.com",
      skipHandshake: true,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const out = await client.callTool<{ ok: boolean }>("x", {});
    expect(out.ok).toBe(true);
  });

  it("throws when the JSON-RPC envelope carries an error", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ jsonrpc: "2.0", id: 1, error: { code: -32601, message: "method not found" } }),
    );
    const client = new HttpMcpClient({
      baseUrl: "https://mcp.example.com",
      skipHandshake: true,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(client.callTool("x", {})).rejects.toThrow(/method not found/);
  });

  it("throws when the tool result reports isError", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ jsonrpc: "2.0", id: 1, result: { isError: true, content: [] } }),
    );
    const client = new HttpMcpClient({
      baseUrl: "https://mcp.example.com",
      skipHandshake: true,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(client.callTool("x", {})).rejects.toThrow(/isError/);
  });

  it("advertises both json and event-stream in Accept", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ jsonrpc: "2.0", id: 1, result: { structuredContent: {} } }),
    );
    const client = new HttpMcpClient({
      baseUrl: "https://mcp.example.com",
      skipHandshake: true,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await client.callTool("x", {});
    const headers = (fetchImpl.mock.calls[0]! as [string, RequestInit])[1].headers as Record<string, string>;
    expect(headers.accept).toContain("application/json");
    expect(headers.accept).toContain("text/event-stream");
  });
});

// ============================================================================
// REST mode (one path per tool — no handshake)
// ============================================================================

describe("HttpMcpClient — rest", () => {
  it("POSTs to /tools/{name} with bearer auth and an arguments envelope", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ items: [] }));
    const client = new HttpMcpClient({
      baseUrl: "https://mcp.kapruka.com/",
      protocol: "rest",
      apiKey: "sk-kap",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await client.callTool("kapruka_search_products", { query: "roses", limit: 5 });

    const [url, init] = fetchImpl.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe("https://mcp.kapruka.com/tools/kapruka_search_products");
    expect(JSON.parse(init.body as string)).toEqual({ arguments: { query: "roses", limit: 5 } });
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer sk-kap");
  });

  it("unwraps a { result } envelope", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ result: { items: [{ id: 1 }] } }));
    const client = new HttpMcpClient({
      baseUrl: "https://mcp.example.com",
      protocol: "rest",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const out = await client.callTool<{ items: unknown[] }>("x", {});
    expect(out.items).toHaveLength(1);
  });

  it("returns the raw payload when there is no envelope", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse([{ city_id: "galle" }]));
    const client = new HttpMcpClient({
      baseUrl: "https://mcp.example.com",
      protocol: "rest",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const out = await client.callTool<unknown[]>("kapruka_list_delivery_cities", {});
    expect(out).toEqual([{ city_id: "galle" }]);
  });
});

// ============================================================================
// shared transport behaviour
// ============================================================================

describe("HttpMcpClient — transport", () => {
  it("throws HttpMcpClientError with status + body on non-2xx", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: "rate limited" }, 429));
    const client = new HttpMcpClient({
      baseUrl: "https://mcp.example.com",
      protocol: "rest",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    try {
      await client.callTool("x", {});
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(HttpMcpClientError);
      const e = err as HttpMcpClientError;
      expect(e.status).toBe(429);
      expect((e.body as { error: string }).error).toBe("rate limited");
    }
  });

  it("maps AbortError onto a timeout-shaped HttpMcpClientError", async () => {
    const fetchImpl = vi.fn(async () => {
      const e = new Error("aborted");
      e.name = "AbortError";
      throw e;
    });
    const client = new HttpMcpClient({
      baseUrl: "https://mcp.example.com",
      skipHandshake: true,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      timeoutMs: 5,
    });
    await expect(client.callTool("x", {})).rejects.toThrow(/timed out/);
  });

  it("omits the authorization header when no apiKey is configured", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ jsonrpc: "2.0", id: 1, result: { structuredContent: {} } }),
    );
    const client = new HttpMcpClient({
      baseUrl: "https://mcp.example.com",
      skipHandshake: true,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await client.callTool("x", {});
    const [, init] = fetchImpl.mock.calls[0]! as [string, RequestInit];
    expect((init.headers as Record<string, string>).authorization).toBeUndefined();
  });
});

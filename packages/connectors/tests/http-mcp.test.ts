import { describe, expect, it, vi } from "vitest";
import { HttpMcpClient, HttpMcpClientError } from "../src/index.js";

function jsonResponse(body: unknown, status = 200, contentType = "application/json"): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": contentType },
  });
}

// ============================================================================
// JSON-RPC mode (default — standard MCP)
// ============================================================================

describe("HttpMcpClient — jsonrpc (default)", () => {
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
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await client.callTool("x", {});
    const headers = (fetchImpl.mock.calls[0]! as [string, RequestInit])[1].headers as Record<string, string>;
    expect(headers.accept).toContain("application/json");
    expect(headers.accept).toContain("text/event-stream");
  });
});

// ============================================================================
// REST mode (one path per tool)
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
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await client.callTool("x", {});
    const [, init] = fetchImpl.mock.calls[0]! as [string, RequestInit];
    expect((init.headers as Record<string, string>).authorization).toBeUndefined();
  });
});

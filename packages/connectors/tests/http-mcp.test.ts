import { describe, expect, it, vi } from "vitest";
import { HttpMcpClient, HttpMcpClientError } from "../src/index.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("HttpMcpClient", () => {
  it("POSTs to /tools/{name} with bearer auth and an arguments envelope", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ items: [] }));
    const client = new HttpMcpClient({
      baseUrl: "https://mcp.kapruka.com/",
      apiKey: "sk-kap",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await client.callTool("kapruka_search_products", { query: "roses", limit: 5 });

    const [url, init] = fetchImpl.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe("https://mcp.kapruka.com/tools/kapruka_search_products");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer sk-kap");
    expect(JSON.parse(init.body as string)).toEqual({
      arguments: { query: "roses", limit: 5 },
    });
  });

  it("unwraps a { result } envelope", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ result: { items: [{ id: 1 }] } }));
    const client = new HttpMcpClient({
      baseUrl: "https://mcp.example.com",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const out = await client.callTool<{ items: unknown[] }>("x", {});
    expect(out.items).toHaveLength(1);
  });

  it("returns the raw payload when there is no envelope", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse([{ city_id: "galle" }]));
    const client = new HttpMcpClient({
      baseUrl: "https://mcp.example.com",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const out = await client.callTool<unknown[]>("kapruka_list_delivery_cities", {});
    expect(out).toEqual([{ city_id: "galle" }]);
  });

  it("throws HttpMcpClientError with status + body on non-2xx", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: "rate limited" }, 429));
    const client = new HttpMcpClient({
      baseUrl: "https://mcp.example.com",
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
    const fetchImpl = vi.fn(async () => jsonResponse({}));
    const client = new HttpMcpClient({
      baseUrl: "https://mcp.example.com",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await client.callTool("x", {});
    const [, init] = fetchImpl.mock.calls[0]! as [string, RequestInit];
    expect((init.headers as Record<string, string>).authorization).toBeUndefined();
  });
});

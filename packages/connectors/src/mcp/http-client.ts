import type { McpClient } from "./client.js";

export type McpProtocol = "jsonrpc" | "rest";

export interface HttpMcpClientOptions {
  /** Base URL of the retailer's MCP HTTP gateway, e.g. https://mcp.kapruka.com */
  baseUrl: string;
  /**
   * Wire protocol.
   *  - "jsonrpc" (default): standard MCP Streamable-HTTP transport — a single
   *    JSON-RPC 2.0 endpoint, tool calls via method "tools/call".
   *  - "rest": one REST path per tool (POST {base}/tools/{name}).
   */
  protocol?: McpProtocol;
  /**
   * Endpoint path appended to baseUrl for JSON-RPC mode. Many MCP servers
   * expose the RPC endpoint at the root ("") or at "/mcp" or "/message".
   * Default: "" (POST to baseUrl itself).
   */
  rpcPath?: string;
  /** Bearer credential. Held server-side; never reaches a channel. */
  apiKey?: string;
  /** Extra headers merged into every request. */
  headers?: Record<string, string>;
  /** Injectable fetch for tests / SSR. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Per-call timeout. Default: 15s. */
  timeoutMs?: number;
}

export class HttpMcpClientError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super(message);
    this.name = "HttpMcpClientError";
  }
}

/**
 * HTTP transport for MCP tool calls.
 *
 * Two wire formats (chosen by `protocol`):
 *
 *  jsonrpc (default) — standard MCP Streamable HTTP:
 *    POST {baseUrl}{rpcPath}
 *    { "jsonrpc":"2.0", "id":N, "method":"tools/call",
 *      "params": { "name":"<tool>", "arguments": {...} } }
 *    Response: { "result": { "structuredContent": {...} | "content":[{type:"text",text:"<json>"}] } }
 *
 *  rest — one path per tool:
 *    POST {baseUrl}/tools/{tool}  with  { "arguments": {...} }
 *
 * Zod validation of the tool payload happens above this layer (the Kapruka
 * normalizers), so this client stays schema-agnostic — it just unwraps the
 * transport envelope and hands back the raw tool result.
 */
export class HttpMcpClient implements McpClient {
  private readonly baseUrl: string;
  private readonly protocol: McpProtocol;
  private readonly rpcPath: string;
  private readonly apiKey: string | undefined;
  private readonly headers: Record<string, string>;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private rpcId = 0;

  constructor(opts: HttpMcpClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.protocol = opts.protocol ?? "jsonrpc";
    this.rpcPath = opts.rpcPath ?? "";
    this.apiKey = opts.apiKey;
    this.headers = opts.headers ?? {};
    this.fetchImpl = opts.fetchImpl ?? fetch.bind(globalThis);
    this.timeoutMs = opts.timeoutMs ?? 15_000;
  }

  async callTool<TResult = unknown>(
    name: string,
    args: Record<string, unknown>,
  ): Promise<TResult> {
    return this.protocol === "rest"
      ? this.callRest<TResult>(name, args)
      : this.callJsonRpc<TResult>(name, args);
  }

  // ---------------- JSON-RPC (standard MCP) ----------------

  private async callJsonRpc<TResult>(name: string, args: Record<string, unknown>): Promise<TResult> {
    const id = ++this.rpcId;
    const raw = await this.post(
      `${this.baseUrl}${this.rpcPath}`,
      {
        jsonrpc: "2.0",
        id,
        method: "tools/call",
        params: { name, arguments: args },
      },
      name,
      // MCP Streamable HTTP servers may answer with SSE; advertise both.
      "application/json, text/event-stream",
    );

    const env = raw as {
      error?: { code?: number; message?: string };
      result?: {
        isError?: boolean;
        structuredContent?: unknown;
        content?: Array<{ type?: string; text?: string }>;
      };
    } | null;

    if (env && env.error) {
      throw new HttpMcpClientError(
        `MCP tool "${name}" returned an error: ${env.error.message ?? "unknown"}`,
        0,
        env.error,
      );
    }
    const result = env?.result;
    if (!result) return raw as TResult;
    if (result.isError) {
      throw new HttpMcpClientError(`MCP tool "${name}" reported isError`, 0, result);
    }
    // Prefer structured content; otherwise JSON-parse the first text block;
    // otherwise hand back the result object as-is.
    if (result.structuredContent !== undefined) return result.structuredContent as TResult;
    const text = result.content?.find((c) => c.type === "text")?.text;
    if (typeof text === "string") {
      try {
        return JSON.parse(text) as TResult;
      } catch {
        return text as unknown as TResult;
      }
    }
    return result as TResult;
  }

  // ---------------- REST (one path per tool) ----------------

  private async callRest<TResult>(name: string, args: Record<string, unknown>): Promise<TResult> {
    const raw = await this.post(
      `${this.baseUrl}/tools/${encodeURIComponent(name)}`,
      { arguments: args },
      name,
      "application/json",
    );
    if (raw !== null && typeof raw === "object" && !Array.isArray(raw) && "result" in raw) {
      return (raw as { result: TResult }).result;
    }
    return raw as TResult;
  }

  // ---------------- shared transport ----------------

  private async post(url: string, body: unknown, toolName: string, accept: string): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      console.log(`[HttpMcpClient] Calling tool "${toolName}" at: ${url}`);
      console.log(`[HttpMcpClient] Request body:`, JSON.stringify(body));
      
      const response = await this.fetchImpl(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept,
          ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
          ...this.headers,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const raw = await this.readBody(response);
      console.log(`[HttpMcpClient] Response status: ${response.status}`);
      
      if (!response.ok) {
        throw new HttpMcpClientError(
          `MCP tool "${toolName}" failed (${response.status})`,
          response.status,
          raw,
        );
      }
      return raw;
    } catch (err) {
      console.error(`[HttpMcpClient] Error in tool "${toolName}":`, err);
      if (err instanceof Error && err.name === "AbortError") {
        throw new HttpMcpClientError(`MCP tool "${toolName}" timed out after ${this.timeoutMs}ms`, 0, null);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Read a JSON body, tolerating an SSE-framed response (data: {...}). */
  private async readBody(response: Response): Promise<unknown> {
    const contentType = response.headers.get("content-type") ?? "";
    const text = await response.text().catch(() => "");
    if (!text) return null;
    if (contentType.includes("text/event-stream") || text.startsWith("data:")) {
      // Take the last `data:` line and parse it as JSON.
      const lines = text.split(/\r?\n/).filter((l) => l.startsWith("data:"));
      const last = lines[lines.length - 1]?.slice(5).trim();
      if (last) {
        try {
          return JSON.parse(last);
        } catch {
          return null;
        }
      }
      return null;
    }
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }
}

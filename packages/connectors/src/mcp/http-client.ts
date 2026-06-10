import type { McpClient } from "./client.js";

export interface HttpMcpClientOptions {
  /** Base URL of the retailer's MCP HTTP gateway, e.g. https://mcp.kapruka.com */
  baseUrl: string;
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
 * Wire contract: POST {baseUrl}/tools/{toolName} with body
 * `{ "arguments": { ... } }`. The response is either the raw tool result or
 * an envelope `{ "result": ... }` — both shapes are accepted, since MCP
 * gateways differ on this. Zod validation of the payload happens above this
 * layer (in the Kapruka normalizers), so this client stays schema-agnostic.
 */
export class HttpMcpClient implements McpClient {
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly headers: Record<string, string>;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(opts: HttpMcpClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.apiKey = opts.apiKey;
    this.headers = opts.headers ?? {};
    this.fetchImpl = opts.fetchImpl ?? fetch.bind(globalThis);
    this.timeoutMs = opts.timeoutMs ?? 15_000;
  }

  async callTool<TResult = unknown>(
    name: string,
    args: Record<string, unknown>,
  ): Promise<TResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(
        `${this.baseUrl}/tools/${encodeURIComponent(name)}`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "application/json",
            ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
            ...this.headers,
          },
          body: JSON.stringify({ arguments: args }),
          signal: controller.signal,
        },
      );
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        throw new HttpMcpClientError(
          `MCP tool "${name}" failed (${response.status})`,
          response.status,
          payload,
        );
      }
      // Unwrap a { result: ... } envelope when present.
      if (
        payload !== null &&
        typeof payload === "object" &&
        !Array.isArray(payload) &&
        "result" in payload
      ) {
        return (payload as { result: TResult }).result;
      }
      return payload as TResult;
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        throw new HttpMcpClientError(`MCP tool "${name}" timed out after ${this.timeoutMs}ms`, 0, null);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}

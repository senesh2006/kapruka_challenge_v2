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
  /**
   * Client info advertised on `initialize`. Optional; defaults to a generic
   * Sevana identifier.
   */
  clientInfo?: { name: string; version: string };
  /**
   * Skip the MCP Streamable-HTTP handshake (initialize + Mcp-Session-Id).
   * Default: false. Set true for servers that explicitly forbid sessions.
   */
  skipHandshake?: boolean;
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
 *  jsonrpc (default) — standard MCP Streamable HTTP, including the session
 *    handshake the spec requires:
 *      1.  POST {baseUrl}{rpcPath}  initialize  →  reads `Mcp-Session-Id` header
 *      2.  POST {baseUrl}{rpcPath}  notifications/initialized  (with session id)
 *      3.  POST {baseUrl}{rpcPath}  tools/call  (with session id) — for every
 *          subsequent call until the session id changes.
 *    If the server returns a 4xx error mentioning a session/initialize
 *    problem, the client clears the cached session id and re-handshakes
 *    exactly once before retrying the original call.
 *
 *  rest — one path per tool, no handshake:
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
  private readonly clientInfo: { name: string; version: string };
  private readonly skipHandshake: boolean;
  private rpcId = 0;
  private sessionId: string | null = null;
  private handshake: Promise<string | null> | null = null;

  constructor(opts: HttpMcpClientOptions) {
    let base = opts.baseUrl.replace(/\/+$/, "");
    if (!base.startsWith("http://") && !base.startsWith("https://")) {
      base = `https://${base}`;
    }
    this.baseUrl = base;
    this.protocol = opts.protocol ?? "jsonrpc";
    this.rpcPath = opts.rpcPath ?? "";
    this.apiKey = opts.apiKey;
    this.headers = opts.headers ?? {};
    this.fetchImpl = opts.fetchImpl ?? fetch.bind(globalThis);
    this.timeoutMs = opts.timeoutMs ?? 15_000;
    this.clientInfo = opts.clientInfo ?? { name: "sevana-hari", version: "1.0.0" };
    this.skipHandshake = opts.skipHandshake ?? false;
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
    if (!this.skipHandshake) await this.ensureSession();
    try {
      return await this.invokeTool<TResult>(name, args);
    } catch (err) {
      // If the server complained about a missing/expired session, re-handshake
      // exactly once and retry. The spec says servers SHOULD return 404 when
      // the Mcp-Session-Id is unknown; many implementations return 400.
      if (!this.skipHandshake && this.isSessionError(err)) {
        console.log(`[HttpMcpClient] Session error on "${name}" — re-handshaking and retrying once.`);
        this.sessionId = null;
        this.handshake = null;
        await this.ensureSession();
        return this.invokeTool<TResult>(name, args);
      }
      throw err;
    }
  }

  private async invokeTool<TResult>(name: string, args: Record<string, unknown>): Promise<TResult> {
    const id = ++this.rpcId;
    const { body: raw } = await this.post(
      `${this.baseUrl}${this.rpcPath}`,
      {
        jsonrpc: "2.0",
        id,
        method: "tools/call",
        params: { name, arguments: args },
      },
      name,
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
      // The MCP spec carries the human-readable failure reason inside the
      // content block(s). Surface it so logs show WHAT the tool complained
      // about (bad arg name, missing field, …) instead of an opaque
      // "isError". `toolError` is a non-retryable flag so the transport
      // doesn't waste backoff cycles on a deterministic application error.
      const detail = (result.content ?? [])
        .map((c) => c?.text)
        .filter((t): t is string => typeof t === "string")
        .join(" ")
        .trim();
      console.error(`[HttpMcpClient] "${name}" reported isError: ${detail || "(no content text)"}`);
      const err = new HttpMcpClientError(
        `MCP tool "${name}" failed: ${detail || "tool reported isError with no detail"}`,
        0,
        result,
      );
      (err as HttpMcpClientError & { toolError?: boolean }).toolError = true;
      throw err;
    }
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

  // ---------------- Streamable HTTP handshake ----------------

  /**
   * Lazily perform the MCP Streamable-HTTP handshake. De-duplicated across
   * concurrent callers via a shared promise so the first batch of tool calls
   * after a cold start doesn't race-initialize.
   */
  private async ensureSession(): Promise<void> {
    if (this.sessionId) return;
    if (!this.handshake) this.handshake = this.doHandshake();
    await this.handshake;
  }

  private async doHandshake(): Promise<string | null> {
    const id = ++this.rpcId;
    const initBody = {
      jsonrpc: "2.0",
      id,
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: this.clientInfo,
      },
    };
    console.log(`[HttpMcpClient] MCP handshake: POST initialize`);
    const { body, headers } = await this.post(
      `${this.baseUrl}${this.rpcPath}`,
      initBody,
      "initialize",
      "application/json, text/event-stream",
      // The very first call has no session id by definition; let the server
      // assign one on the response.
      { skipSessionHeader: true },
    );

    // Servers reply with the session id in the `Mcp-Session-Id` header (case
    // insensitive). Capture it for every subsequent request.
    const sid =
      headers.get("mcp-session-id") ??
      headers.get("Mcp-Session-Id") ??
      headers.get("MCP-Session-Id") ??
      null;
    this.sessionId = sid;
    if (sid) console.log(`[HttpMcpClient] Acquired Mcp-Session-Id: ${sid}`);
    else console.log(`[HttpMcpClient] Server returned no Mcp-Session-Id — proceeding sessionless.`);

    // Surface protocol-level errors so we don't proceed against a broken
    // handshake (e.g. wrong protocolVersion).
    const env = body as { error?: { code?: number; message?: string } } | null;
    if (env && env.error) {
      throw new HttpMcpClientError(
        `MCP initialize failed: ${env.error.message ?? "unknown"}`,
        0,
        env.error,
      );
    }

    // The spec requires a follow-up notification telling the server we're
    // ready. Fire-and-forget — a 2xx without body is the expected reply, and
    // failures shouldn't block the first tool call.
    await this.post(
      `${this.baseUrl}${this.rpcPath}`,
      { jsonrpc: "2.0", method: "notifications/initialized" },
      "notifications/initialized",
      "application/json, text/event-stream",
    ).catch((err) => {
      console.log(`[HttpMcpClient] notifications/initialized failed (non-fatal):`, err);
    });

    return sid;
  }

  /** True when the error looks like "session is missing / unknown / expired". */
  private isSessionError(err: unknown): boolean {
    if (!(err instanceof HttpMcpClientError)) return false;
    if (err.status === 404) return true; // spec: unknown session id
    const body = err.body as
      | { error?: { code?: number; message?: string }; message?: string }
      | null
      | undefined;
    const msg =
      body?.error?.message ?? body?.message ?? (typeof err.body === "string" ? err.body : "");
    if (typeof msg !== "string") return false;
    return /session|initialize|not.?initialized/i.test(msg);
  }

  // ---------------- REST (one path per tool) ----------------

  private async callRest<TResult>(name: string, args: Record<string, unknown>): Promise<TResult> {
    const { body: raw } = await this.post(
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

  private async post(
    url: string,
    body: unknown,
    toolName: string,
    accept: string,
    opts: { skipSessionHeader?: boolean } = {},
  ): Promise<{ body: unknown; headers: Headers }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const sessionHeader =
        !opts.skipSessionHeader && this.sessionId
          ? { "mcp-session-id": this.sessionId }
          : {};
      const response = await this.fetchImpl(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept,
          ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
          ...sessionHeader,
          ...this.headers,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const raw = await this.readBody(response);
      if (!response.ok) {
        console.error(
          `[HttpMcpClient] "${toolName}" → ${response.status} ${response.statusText}`,
        );
        throw new HttpMcpClientError(
          `MCP tool "${toolName}" failed (${response.status})`,
          response.status,
          raw,
        );
      }
      return { body: raw, headers: response.headers };
    } catch (err) {
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

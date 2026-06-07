import {
  ChatResponseSchema,
  type ChatRequest,
  type ChatResponse,
} from "../types/index.js";
import { NimError, NimRateLimitError, NimTimeoutError } from "../errors/index.js";

/**
 * Pluggable transport so tests and self-host adapters can swap out the wire
 * call without re-implementing the OpenAI-compatible shape.
 */
export interface HttpTransport {
  fetch(input: { url: string; init: RequestInit; signal: AbortSignal }): Promise<HttpResponse>;
}

export interface HttpResponse {
  ok: boolean;
  status: number;
  statusText: string;
  json(): Promise<unknown>;
}

export const fetchTransport: HttpTransport = {
  fetch: async ({ url, init, signal }) => {
    const res = await fetch(url, { ...init, signal });
    return {
      ok: res.ok,
      status: res.status,
      statusText: res.statusText,
      json: () => res.json() as Promise<unknown>,
    };
  },
};

export interface NimClientOptions {
  /** OpenAI-compatible endpoint. NIM cloud default. */
  baseUrl: string;
  /** Per-tenant API key. Held server-side. */
  apiKey: string;
  /** Optional injected transport (defaults to global fetch). */
  transport?: HttpTransport;
  /** Per-call timeout. Default: 30s. */
  timeoutMs?: number;
}

/**
 * Thin OpenAI-compatible NIM client. Routes are applied above this — the
 * client just speaks the wire protocol.
 *
 * Hosted NIM endpoint: https://integrate.api.nvidia.com/v1 (per PRD §11).
 * Self-hosted NIM containers expose the same shape, so the only thing that
 * changes for a private deployment is `baseUrl` and `apiKey`.
 */
export class NimClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly transport: HttpTransport;
  private readonly timeoutMs: number;

  constructor(opts: NimClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.apiKey = opts.apiKey;
    this.transport = opts.transport ?? fetchTransport;
    this.timeoutMs = opts.timeoutMs ?? 30_000;
  }

  async chatCompletion(model: string, request: ChatRequest): Promise<ChatResponse> {
    const body = JSON.stringify({ model, ...request });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.transport.fetch({
        url: `${this.baseUrl}/chat/completions`,
        init: {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${this.apiKey}`,
            accept: "application/json",
          },
          body,
        },
        signal: controller.signal,
      });
      if (!response.ok) {
        if (response.status === 429) throw new NimRateLimitError();
        throw new NimError(`NIM call failed: ${response.status} ${response.statusText}`, response.status);
      }
      const raw = await response.json();
      return ChatResponseSchema.parse(raw);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        throw new NimTimeoutError(this.timeoutMs);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}

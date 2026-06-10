import {
  TurnResponseSchema,
  type ChannelKind,
  type TurnRequest,
  type TurnResponse,
} from "./types.js";
import {
  BrowserSessionStore,
  newSessionId,
  type SessionStore,
} from "./SessionStore.js";

export interface ChannelClientOptions {
  /** Where to POST turns. Default: "/api/turn". */
  endpoint?: string;
  /** Channel adapter identity, sent for analytics. */
  channel?: ChannelKind;
  /** Optional fetch override (tests inject a stub; SSR can pass node fetch). */
  fetchImpl?: typeof fetch;
  /** Optional session store override. Defaults to BrowserSessionStore. */
  sessionStore?: SessionStore;
  /** Tenant id for analytics + future tenant routing. */
  tenantId?: string;
  /** Extra headers (auth, csrf, etc.) merged into every request. */
  headers?: Record<string, string>;
}

export class ChannelClientError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super(message);
    this.name = "ChannelClientError";
  }
}

/**
 * Thin client SDK. One concierge core, many channels — every adapter (widget,
 * full-page, mobile SDK, messaging gateway) speaks to the orchestrator via
 * the same POST contract. Wraps session continuity and basic error mapping.
 */
export class ChannelClient {
  private readonly endpoint: string;
  private readonly channel: ChannelKind;
  private readonly fetchImpl: typeof fetch;
  private readonly sessionStore: SessionStore;
  private readonly headers: Record<string, string>;
  private readonly tenantId: string | undefined;

  constructor(opts: ChannelClientOptions = {}) {
    this.endpoint = opts.endpoint ?? "/api/turn";
    this.channel = opts.channel ?? "full-page";
    this.fetchImpl =
      opts.fetchImpl ??
      (typeof fetch !== "undefined"
        ? fetch.bind(globalThis)
        : ((): typeof fetch => {
            throw new Error("No fetch implementation available — inject one via opts.fetchImpl");
          })());
    this.sessionStore = opts.sessionStore ?? new BrowserSessionStore();
    this.headers = opts.headers ?? {};
    this.tenantId = opts.tenantId;
  }

  /** Returns the session id, creating one if needed. Idempotent. Async so
   *  it can back an async session store (React Native AsyncStorage). */
  async ensureSessionId(): Promise<string> {
    const existing = await this.sessionStore.get();
    if (existing) return existing;
    const fresh = newSessionId();
    await this.sessionStore.set(fresh);
    return fresh;
  }

  async resetSession(): Promise<string> {
    await this.sessionStore.clear();
    return this.ensureSessionId();
  }

  channelKind(): ChannelKind {
    return this.channel;
  }

  async sendTurn(message: string, opts: { signal?: AbortSignal } = {}): Promise<TurnResponse> {
    const trimmed = message.trim();
    if (!trimmed) throw new ChannelClientError("message is empty", 0, null);
    const sessionId = await this.ensureSessionId();
    const body: TurnRequest = { sessionId, message: trimmed };

    const response = await this.fetchImpl(this.endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        "x-sevana-channel": this.channel,
        ...(this.tenantId ? { "x-tenant-id": this.tenantId } : {}),
        ...this.headers,
      },
      body: JSON.stringify(body),
      ...(opts.signal ? { signal: opts.signal } : {}),
    });

    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      throw new ChannelClientError(
        `turn failed (${response.status})`,
        response.status,
        payload,
      );
    }
    return TurnResponseSchema.parse(payload);
  }
}

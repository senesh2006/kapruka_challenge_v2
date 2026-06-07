import type { Event, TenantId } from "@sevana/shared";
import type { Clock } from "../kapruka/clock.js";
import { wallClock } from "../kapruka/clock.js";
import type { EventBus } from "./bus.js";
import type { IdempotencyStore } from "./idempotency.js";
import type { WebhookPayloadMapper } from "./mappers.js";
import { KaprukaWebhookMapper } from "./mappers.js";
import {
  DEFAULT_SIGNATURE_SCHEME,
  HmacSha256Verifier,
  type SignatureVerifier,
} from "./signature.js";

export interface WebhookSecretResolver {
  resolve(tenantId: TenantId): Promise<string | null>;
}

export interface WebhookRequest {
  tenantId: TenantId;
  rawBody: string;
  headers: Record<string, string>;
}

export type WebhookOutcomeCode = "signature" | "tenant" | "payload" | "unsupported" | "no-event-id";

export type WebhookOutcome =
  | { status: "accepted"; event: Event }
  | { status: "duplicate"; eventId: string }
  | { status: "rejected"; reason: string; code: WebhookOutcomeCode };

export interface WebhookReceiverRetry {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export interface WebhookReceiverOptions {
  secretResolver: WebhookSecretResolver;
  idempotency: IdempotencyStore;
  bus: EventBus;
  verifier?: SignatureVerifier;
  mapper?: WebhookPayloadMapper;
  clock?: Clock;
  retry?: Partial<WebhookReceiverRetry>;
}

const DEFAULT_RETRY: WebhookReceiverRetry = {
  maxAttempts: 4,
  baseDelayMs: 100,
  maxDelayMs: 2_000,
};

export class WebhookReceiver {
  private readonly secretResolver: WebhookSecretResolver;
  private readonly idempotency: IdempotencyStore;
  private readonly bus: EventBus;
  private readonly verifier: SignatureVerifier;
  private readonly mapper: WebhookPayloadMapper;
  private readonly clock: Clock;
  private readonly retry: WebhookReceiverRetry;

  constructor(opts: WebhookReceiverOptions) {
    this.secretResolver = opts.secretResolver;
    this.idempotency = opts.idempotency;
    this.bus = opts.bus;
    this.verifier = opts.verifier ?? new HmacSha256Verifier(DEFAULT_SIGNATURE_SCHEME);
    this.mapper = opts.mapper ?? new KaprukaWebhookMapper();
    this.clock = opts.clock ?? wallClock;
    this.retry = { ...DEFAULT_RETRY, ...opts.retry };
  }

  async handle(req: WebhookRequest): Promise<WebhookOutcome> {
    const secret = await this.secretResolver.resolve(req.tenantId);
    if (!secret) {
      return { status: "rejected", reason: "no signing secret for tenant", code: "tenant" };
    }

    if (!this.verifier.verify(req.rawBody, req.headers, secret, this.clock.now())) {
      return { status: "rejected", reason: "signature mismatch", code: "signature" };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(req.rawBody);
    } catch {
      return { status: "rejected", reason: "invalid JSON", code: "payload" };
    }

    const eventId = this.mapper.extractEventId(parsed);
    if (!eventId) {
      return { status: "rejected", reason: "missing event id", code: "no-event-id" };
    }

    const idemKey = `${String(req.tenantId)}::${eventId}`;
    const reserved = await this.idempotency.tryReserve(idemKey);
    if (!reserved) {
      return { status: "duplicate", eventId };
    }

    const mapped = this.mapper.map(parsed, { tenantId: req.tenantId });
    if (!mapped.ok) {
      await this.idempotency.release(idemKey);
      const code: WebhookOutcomeCode = mapped.error.reason.startsWith("unsupported")
        ? "unsupported"
        : "payload";
      return { status: "rejected", reason: mapped.error.reason, code };
    }

    try {
      await this.publishWithRetry(mapped.event);
    } catch (err) {
      // Release the reservation so the retailer's next redelivery is reprocessed.
      await this.idempotency.release(idemKey);
      throw err;
    }

    await this.idempotency.commit(idemKey);
    return { status: "accepted", event: mapped.event };
  }

  private async publishWithRetry(event: Event): Promise<void> {
    let attempt = 0;
    let delay = this.retry.baseDelayMs;
    while (true) {
      attempt += 1;
      try {
        await this.bus.publish(event);
        return;
      } catch (err) {
        if (attempt >= this.retry.maxAttempts) throw err;
        await this.clock.sleep(Math.min(delay, this.retry.maxDelayMs));
        delay = Math.min(delay * 2, this.retry.maxDelayMs);
      }
    }
  }
}

import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  KaprukaWebhookMapper,
  WebhookReceiver,
} from "@sevana/connectors";
import { TenantIdSchema } from "@sevana/shared";
import { bootstrap } from "./_lib.js";

/**
 * Retailer webhook endpoint.
 *
 *  POST /api/webhook
 *  Header: x-kapruka-signature (HMAC-SHA256 of the raw body, hex)
 *  Body: { event_id, event_type, occurred_at, order_ref, session_ref? }
 *
 * Verifies the signature, maps the payload to a typed Event in the shared
 * model, attaches the tenantId, and publishes onto the internal event bus.
 * Idempotency is persisted in Vercel Blob so a re-delivered webhook is not
 * double-counted even across serverless cold starts.
 *
 * Required env: WEBHOOK_SECRET.
 * Body is read raw from the request stream (Vercel parses it as JSON by
 * default; we re-stringify deterministically for the HMAC check).
 */

let receiver: WebhookReceiver | null = null;

async function getReceiver(): Promise<WebhookReceiver | null> {
  const secret = process.env.WEBHOOK_SECRET;
  if (!secret) return null;
  if (receiver) return receiver;
  const { idempotency, bus } = await bootstrap();
  // bus is shared with the analytics recorder; webhook events flow straight
  // into the analytics log.
  receiver = new WebhookReceiver({
    bus,
    idempotency,
    mapper: new KaprukaWebhookMapper(),
    secretResolver: { resolve: async () => secret },
  });
  return receiver;
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).json({ error: "method not allowed" });
    return;
  }
  const r = await getReceiver();
  if (!r) {
    res.status(503).json({ error: "WEBHOOK_SECRET not configured" });
    return;
  }

  const rawBody = JSON.stringify(req.body ?? {});
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (typeof v === "string") headers[k] = v;
  }
  const tenantHeader = req.headers["x-tenant-id"];
  const tenantId = TenantIdSchema.parse(
    typeof tenantHeader === "string" ? tenantHeader : "kapruka",
  );

  try {
    const outcome = await r.handle({ tenantId, rawBody, headers });
    if (outcome.status === "accepted") {
      res.status(202).json({ status: "accepted", eventId: outcome.event.id });
      return;
    }
    if (outcome.status === "duplicate") {
      res.status(200).json({ status: "duplicate", eventId: outcome.eventId });
      return;
    }
    // rejected
    const map: Record<string, number> = {
      signature: 401,
      tenant: 403,
      payload: 422,
      unsupported: 422,
      "no-event-id": 422,
    };
    res.status(map[outcome.code] ?? 400).json({
      status: "rejected",
      code: outcome.code,
      reason: outcome.reason,
    });
  } catch (err) {
    // Bus publish exhausted retries — release was already handled by the
    // receiver, so 5xx tells the retailer to re-deliver.
    res.status(503).json({
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

import { createHmac, timingSafeEqual } from "node:crypto";
import type { VercelRequest, VercelResponse } from "@vercel/node";

/**
 * Retailer webhook endpoint (order / payment / fulfilment events).
 *
 * Vercel parses JSON bodies automatically. For signature verification we need
 * the *raw* body, so this handler re-stringifies the parsed body deterministically.
 * Production wires this into @sevana/connectors/webhooks → WebhookReceiver,
 * which does signature verification, idempotency, mapping to typed Event, and
 * publishes to the internal event bus.
 *
 * Set WEBHOOK_SECRET in the Vercel env so the signature check works in the
 * scaffold deployment.
 */
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).json({ error: "method not allowed" });
    return;
  }

  const secret = process.env.WEBHOOK_SECRET;
  if (!secret) {
    res.status(503).json({ error: "WEBHOOK_SECRET not configured" });
    return;
  }

  const provided = String(req.headers["x-kapruka-signature"] ?? "");
  const raw = JSON.stringify(req.body ?? {});
  const expected = createHmac("sha256", secret).update(raw, "utf8").digest("hex");

  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    res.status(401).json({ error: "signature mismatch" });
    return;
  }

  // Scaffold acks. Production calls WebhookReceiver.handle(...) here and the
  // event lands on the internal bus.
  res.status(202).json({ status: "accepted-stub" });
}

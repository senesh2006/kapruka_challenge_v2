import { z } from "zod";
import { EventSchema, type Event, type TenantId } from "@sevana/shared";

/**
 * Raw Kapruka webhook envelope. Production retailers will send different
 * shapes; each gets its own WebhookPayloadMapper that knows how to translate
 * its shape into the canonical Event union from @sevana/shared.
 */
const KaprukaWebhookSchema = z.object({
  event_id: z.string().min(1),
  event_type: z.string().min(1),
  occurred_at: z.string().datetime(),
  order_ref: z.string().min(1),
  session_ref: z.string().optional(),
});
export type KaprukaRawWebhook = z.infer<typeof KaprukaWebhookSchema>;

export interface MapContext {
  tenantId: TenantId;
}

export interface MappingError {
  reason: string;
}

export type MapResult = { ok: true; event: Event } | { ok: false; error: MappingError };

export interface WebhookPayloadMapper {
  extractEventId(raw: unknown): string | null;
  map(raw: unknown, ctx: MapContext): MapResult;
}

const ORDER_STATUS = new Map<string, "created" | "confirmed" | "cancelled">([
  ["order.created", "created"],
  ["order.confirmed", "confirmed"],
  ["order.cancelled", "cancelled"],
]);
const PAYMENT_STATUS = new Map<string, "initiated" | "succeeded" | "failed">([
  ["payment.initiated", "initiated"],
  ["payment.succeeded", "succeeded"],
  ["payment.failed", "failed"],
]);
const FULFILMENT_STATUS = new Map<string, "packed" | "dispatched" | "delivered" | "failed">([
  ["fulfilment.packed", "packed"],
  ["fulfilment.dispatched", "dispatched"],
  ["fulfilment.delivered", "delivered"],
  ["fulfilment.failed", "failed"],
]);

export class KaprukaWebhookMapper implements WebhookPayloadMapper {
  extractEventId(raw: unknown): string | null {
    const parsed = z.object({ event_id: z.string().optional() }).safeParse(raw);
    return parsed.success && parsed.data.event_id ? parsed.data.event_id : null;
  }

  map(raw: unknown, ctx: MapContext): MapResult {
    const parsed = KaprukaWebhookSchema.safeParse(raw);
    if (!parsed.success) {
      return { ok: false, error: { reason: `payload validation failed: ${parsed.error.message}` } };
    }
    const r = parsed.data;
    const base = { id: r.event_id, tenantId: ctx.tenantId, at: r.occurred_at };

    const orderStatus = ORDER_STATUS.get(r.event_type);
    if (orderStatus) {
      if (!r.session_ref) {
        return { ok: false, error: { reason: "order event requires session_ref" } };
      }
      return finalize({ ...base, kind: "order", sessionId: r.session_ref, orderId: r.order_ref, status: orderStatus });
    }

    const paymentStatus = PAYMENT_STATUS.get(r.event_type);
    if (paymentStatus) {
      return finalize({ ...base, kind: "payment", orderId: r.order_ref, status: paymentStatus });
    }

    const fulfilmentStatus = FULFILMENT_STATUS.get(r.event_type);
    if (fulfilmentStatus) {
      return finalize({ ...base, kind: "fulfilment", orderId: r.order_ref, status: fulfilmentStatus });
    }

    return { ok: false, error: { reason: `unsupported event_type: ${r.event_type}` } };
  }
}

function finalize(candidate: unknown): MapResult {
  const parsed = EventSchema.safeParse(candidate);
  if (!parsed.success) {
    return { ok: false, error: { reason: `event schema rejected: ${parsed.error.message}` } };
  }
  return { ok: true, event: parsed.data };
}

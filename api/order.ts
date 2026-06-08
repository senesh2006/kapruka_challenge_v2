import type { VercelRequest, VercelResponse } from "@vercel/node";
import { OrderContextSchema, TenantScope } from "@sevana/shared";
import { bootstrap, demoTenant } from "./_lib.js";

/**
 * Explicit-confirmation–gated order endpoint (FR-10).
 *
 *  POST /api/order
 *  Body: { orderContext: OrderContext, confirm: true }
 *
 * The Guardrail agent refuses to create the order if `confirm !== true`.
 * On approval, the connector returns the retailer pay link, which the
 * customer follows to actually pay. Sevana never handles payment directly.
 */
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).json({ error: "method not allowed" });
    return;
  }
  const body = (req.body ?? {}) as { orderContext?: unknown; confirm?: boolean; sessionId?: string };
  if (!body.orderContext) {
    res.status(400).json({ error: "orderContext is required" });
    return;
  }

  let orderContext;
  try {
    orderContext = OrderContextSchema.parse(body.orderContext);
  } catch (err) {
    res.status(422).json({
      error: "orderContext schema validation failed",
      detail: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  try {
    const { orchestrator, orders, sessions } = await bootstrap();
    const tenant = demoTenant();
    const scope = new TenantScope(tenant.id);
    const session = await sessions.get(orderContext.sessionId, scope);
    if (!session) {
      res.status(404).json({ error: "session not found" });
      return;
    }
    const result = await orchestrator.createOrder({
      plan: { brief: { situation: "", detectedLocale: "en", slots: [] }, candidatesBySlot: {}, cart: [] },
      session,
      tenant,
      orderContext,
      explicitConfirmation: body.confirm === true,
    });
    await orders.upsert(
      {
        ...orderContext,
        status: "awaiting-payment",
        payLink: result.confirmation.payLink,
        updatedAt: new Date().toISOString(),
      },
      scope,
    );
    res.status(200).json({
      retailerOrderRef: result.confirmation.retailerOrderRef,
      payLink: result.confirmation.payLink,
      expectedTotal: result.confirmation.expectedTotal,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const code = msg.includes("explicit confirmation") ? 412 : 500;
    res.status(code).json({ error: msg });
  }
}

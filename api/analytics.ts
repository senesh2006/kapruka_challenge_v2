import type { VercelRequest, VercelResponse } from "@vercel/node";
import { TenantIdSchema } from "@sevana/shared";
import { bootstrap } from "./_lib.js";

/**
 * Analytics summary endpoint.
 *
 *  GET /api/analytics?from=ISO&to=ISO
 *
 * Returns the merchant-console-ready aggregations from the Blob-backed
 * EventRepository: funnel, channel mix, demand signals, payment +
 * fulfilment success rates. Tenant defaults to "kapruka" for the pilot;
 * future multi-retailer routing resolves tenant from auth.
 */
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== "GET") {
    res.status(405).json({ error: "method not allowed" });
    return;
  }
  const fromRaw = req.query.from;
  const toRaw = req.query.to;
  const from = typeof fromRaw === "string" ? fromRaw : undefined;
  const to = typeof toRaw === "string" ? toRaw : undefined;
  const tenantParam = req.query.tenantId;
  const tenantId = TenantIdSchema.parse(
    typeof tenantParam === "string" ? tenantParam : "kapruka",
  );

  try {
    const { analytics } = await bootstrap();
    const summary = await analytics.summary(tenantId, {
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
    });
    res.status(200).json(summary);
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

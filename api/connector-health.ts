import type { VercelRequest, VercelResponse } from "@vercel/node";
import { bootstrap } from "./_lib.js";

/**
 * Connector reachability probe.
 *
 *  GET /api/connector-health
 *
 * Calls catalogue.listCategories() through whatever connector is active
 * (Kapruka MCP when KAPRUKA_MCP_BASE_URL is set, demo otherwise). A 200
 * means the full path — registry → transport (rate limit + cache) → MCP
 * client → normaliser — round-trips. 502 carries the upstream error.
 */
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== "GET") {
    res.status(405).json({ error: "method not allowed" });
    return;
  }
  try {
    const { connector } = await bootstrap();
    const started = Date.now();
    const categories = await connector.catalogue.listCategories();
    res.status(200).json({
      ok: true,
      adapter: connector.catalogue.adapter,
      categories: categories.length,
      latencyMs: Date.now() - started,
      at: new Date().toISOString(),
    });
  } catch (err) {
    res.status(502).json({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

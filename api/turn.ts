import type { VercelRequest, VercelResponse } from "@vercel/node";

/**
 * Orchestrator turn endpoint.
 *
 * This is the seam where the deployed console talks to the agent core. For
 * the scaffold deployment, the handler returns a canned reply that matches
 * the `TurnResult` shape from @sevana/orchestrator so the UI can demo the
 * flow without NIM keys or a live Kapruka MCP.
 *
 * For production: replace the stub with:
 *   1. Resolve the tenant + persona from the request headers or auth.
 *   2. Build a `RetailerConnector` via @sevana/connectors registry (Kapruka MCP).
 *   3. Build a `ModelGateway` via @sevana/model-gateway with the tenant's NIM key.
 *   4. Instantiate `Orchestrator` with the six agents and call `handleTurn`.
 */
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).json({ error: "method not allowed" });
    return;
  }

  const body = (req.body ?? {}) as { sessionId?: string; message?: string };
  const message = String(body.message ?? "").trim();
  if (!message) {
    res.status(400).json({ error: "message is required" });
    return;
  }

  // ---- Scaffold reply -----------------------------------------------------
  // Demonstrates the TurnResult contract. Production wiring described above.
  const stubReply = `Hari: I've read "${message.slice(0, 80)}" — I'd suggest a thoughtful, hand-delivered set. (Scaffold response — wire @sevana/orchestrator here.)`;
  res.status(200).json({
    reply: stubReply,
    cardRefs: [],
    guardrailVerdict: "approved",
    sessionId: body.sessionId ?? "demo-session",
    at: new Date().toISOString(),
  });
}

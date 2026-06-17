import type { VercelRequest, VercelResponse } from "@vercel/node";
import { TenantScope } from "@sevana/shared";
import { bootstrap, demoTenant, getOrCreateSession } from "./_lib.js";

/**
 * Orchestrator turn endpoint.
 *
 *  POST /api/turn
 *  Body: { sessionId: string, message: string }
 *
 * Sessions persist via @sevana/storage → Vercel Blob (BLOB_READ_WRITE_TOKEN).
 * When the token isn't set, the adapter falls back to in-memory so previews
 * still respond — but data won't survive between cold starts.
 *
 * The Concierge stub is in place of NIM for now; everything else (Shopper,
 * Logistics, Merchandiser, Retention, Guardrail) runs end-to-end through
 * the real orchestrator loop.
 */
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).json({ error: "method not allowed" });
    return;
  }
  const body = (req.body ?? {}) as { sessionId?: string; message?: string };
  const message = String(body.message ?? "").trim();
  const sessionId = String(body.sessionId ?? "").trim();
  if (!message || !sessionId) {
    res.status(400).json({ error: "sessionId and message are required" });
    return;
  }

  try {
    const { orchestrator, sessions } = await bootstrap();
    const tenant = demoTenant();
    const session = await getOrCreateSession(sessionId, tenant, "full-page");

    const result = await orchestrator.handleTurn({
      session,
      tenant,
      customerMessage: message,
    });

    // Persist the session with the appended transcript turn and updated cart for continuity.
    const scope = new TenantScope(tenant.id);
    const nextSession = {
      ...session,
      cart: result.plan.cart,
      brief: {
        ...session.brief,
        situation: result.briefAfter.situation,
        recipient: result.briefAfter.recipient,
        budget: result.briefAfter.budget?.max,
        occasionDate: result.briefAfter.occasionDate,
      },
      transcript: [
        ...session.transcript,
        { role: "customer" as const, content: message, at: new Date().toISOString() },
        { role: "concierge" as const, content: result.reply, at: new Date().toISOString() },
      ],
      lastTouchedAt: new Date().toISOString(),
    };
    await sessions.upsert(nextSession, scope);

    res.status(200).json({
      sessionId,
      reply: result.reply,
      cardRefs: result.cardRefs,
      cards: result.cards,
      emotion: result.emotion,
      guardrailVerdict: result.guardrailVerdict,
      detectedLocale: result.briefAfter.detectedLocale,
      at: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

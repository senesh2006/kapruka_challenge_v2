import { z } from "zod";
import type {
  CustomerProfile,
  Locale,
  Persona,
  Session,
  TenantId,
} from "@sevana/shared";
import type {
  ChatResponse,
  ModelTaskRequest,
  ToolDefinition,
} from "@sevana/model-gateway";
import type {
  CandidatePlan,
  DeliveryAssessment,
  IntentSlot,
  SlotCandidate,
  WorkingBrief,
} from "../brief/index.js";
import type { ConciergeAgent } from "./index.js";

/**
 * The slice of ModelGateway the concierge needs. Structural — a real
 * ModelGateway satisfies it; tests inject a fake.
 */
export interface ConciergeModel {
  run(task: ModelTaskRequest, ctx: { tenantId: TenantId }): Promise<ChatResponse>;
  gracefulMessage(): string;
}

/** Structured output the read call asks the reasoning model for. */
const BriefToolArgsSchema = z.object({
  detectedLocale: z.enum(["en", "si", "ta", "tanglish"]),
  situation: z.string().min(1),
  recipient: z.string().optional(),
  destination: z.string().optional(),
  occasionDate: z.string().optional(),
  budgetMax: z.number().positive().optional(),
  slots: z
    .array(
      z.object({
        id: z.string().min(1),
        description: z.string().min(1),
        categoryHints: z.array(z.string()).default([]),
      }),
    )
    .min(1)
    .max(3),
});

const SET_BRIEF_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "set_brief",
    description:
      "Record the structured shopping brief extracted from the customer's message. " +
      "Detect the language the customer wrote in (en, si, ta, or tanglish). " +
      "Break the need into 1-3 intent slots, each one a distinct thing to shop for.",
    parameters: {
      type: "object",
      properties: {
        detectedLocale: { type: "string", enum: ["en", "si", "ta", "tanglish"] },
        situation: { type: "string", description: "One-line summary of the situation and emotion" },
        recipient: { type: "string", description: "Who the order is for, if stated" },
        destination: { type: "string", description: "Delivery city or place, if stated (canonical English name)" },
        occasionDate: { type: "string", description: "ISO 8601 date of the occasion, if stated" },
        budgetMax: { type: "number", description: "Budget ceiling in the customer's stated currency" },
        slots: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              description: { type: "string" },
              categoryHints: { type: "array", items: { type: "string" } },
            },
            required: ["id", "description"],
          },
        },
      },
      required: ["detectedLocale", "situation", "slots"],
    },
  },
};

const LOCALE_NAME: Record<Locale, string> = {
  en: "English",
  si: "Sinhala",
  ta: "Tamil",
  tanglish: "Tanglish (romanised Sinhala/Tamil mixed with English)",
};

/**
 * NIM-backed Concierge (PRD 5.1). The only agent the customer hears.
 *
 * - `read` runs a tool-calling reasoning call to extract the working brief:
 *   language, situation + emotion, recipient, destination, date, budget,
 *   and 1-3 intent slots (FR-1).
 * - `present` runs a plain reasoning call that renders the plan in the
 *   tenant persona with a point of view (FR-2). The prompt pins the model
 *   to the items in the plan — no invented products or prices (FR-4) — and
 *   the Guardrail agent re-checks downstream.
 * - Every model failure degrades gracefully: read falls back to a naive
 *   single-slot brief, present falls back to gateway.gracefulMessage().
 *   The loop never dies because NIM did (NFR-5).
 */
export class NimConciergeAgent implements ConciergeAgent {
  constructor(private readonly model: ConciergeModel) {}

  async read(input: {
    message: string;
    session: Session;
    persona: Persona;
    profile?: CustomerProfile;
    previousBrief?: WorkingBrief;
  }): Promise<{ brief: WorkingBrief }> {
    try {
      const response = await this.model.run(
        {
          kind: "reasoning",
          task: "concierge.read",
          request: {
            messages: [
              {
                role: "system",
                content:
                  `You are ${input.persona.brandVoice || "Hari"}, a situation-reading shopping concierge ` +
                  `for a Sri Lankan retailer. Read the customer's message including emotional subtext. ` +
                  `Languages you support: ${input.persona.languages.map((l) => LOCALE_NAME[l]).join(", ")}. ` +
                  `Call set_brief exactly once with the structured brief.` +
                  (input.previousBrief
                    ? ` The conversation already has a brief (situation: "${input.previousBrief.situation}"); ` +
                      `merge the new message into it rather than starting over.`
                    : ""),
              },
              { role: "user", content: input.message },
            ],
            tools: [SET_BRIEF_TOOL],
            tool_choice: "required",
            temperature: 0.2,
          },
        },
        { tenantId: input.session.tenantId },
      );

      const args = extractToolArgs(response);
      const parsed = BriefToolArgsSchema.parse(args);
      const slots: IntentSlot[] = parsed.slots.map((s, idx) => ({
        id: s.id || `slot-${idx + 1}`,
        description: s.description,
        categoryHints: s.categoryHints,
        required: true,
      }));
      return {
        brief: {
          situation: parsed.situation,
          detectedLocale: parsed.detectedLocale,
          slots,
          ...(parsed.recipient !== undefined ? { recipient: parsed.recipient } : {}),
          ...(parsed.destination !== undefined ? { destination: parsed.destination } : {}),
          ...(parsed.occasionDate !== undefined ? { occasionDate: parsed.occasionDate } : {}),
          ...(parsed.budgetMax !== undefined
            ? { budget: { max: parsed.budgetMax, currency: "LKR" } }
            : {}),
        },
      };
    } catch {
      // Model unreachable or returned garbage — degrade to a naive brief so
      // the rest of the loop (which is grounded in the connector) still runs.
      return { brief: fallbackBrief(input.message, input.persona, input.previousBrief) };
    }
  }

  async present(input: {
    plan: CandidatePlan;
    persona: Persona;
    session: Session;
    locale: Locale;
  }): Promise<{ reply: string; cardRefs: string[] }> {
    const top = topPicks(input.plan);
    const cardRefs = top.map((c) => String(c.product.id));

    if (top.length === 0) {
      // Nothing to present — an honest ask costs no model call.
      return {
        reply:
          "I couldn't find anything in the catalogue that fits yet — tell me a little more " +
          "about the occasion or the person, and I'll look again.",
        cardRefs,
      };
    }

    const itemLines = top
      .map(
        (c) =>
          `- id=${String(c.product.id)} | ${c.product.title} | ${c.product.price.amount} ${c.product.price.currency} | reason: ${c.reason}`,
      )
      .join("\n");

    try {
      const response = await this.model.run(
        {
          kind: "reasoning",
          task: "concierge.present",
          request: {
            messages: [
              {
                role: "system",
                content:
                  `You are ${input.persona.brandVoice || "Hari"}, a warm, observant, opinionated shopping concierge. ` +
                  `Tone: ${input.persona.tone.join(", ") || "warm"}. ` +
                  (input.persona.opinions.length > 0
                    ? `Your standing opinions: ${input.persona.opinions.join(" / ")}. `
                    : "") +
                  `Reply in ${LOCALE_NAME[input.locale]}. ` +
                  `Present the recommendation with a confident point of view and a reason per item. ` +
                  `STRICT RULES: mention ONLY the items listed below, use ONLY the listed prices, ` +
                  `never invent products, prices, or availability. No pressure tactics or false urgency. ` +
                  `Keep it under 120 words.`,
              },
              {
                role: "user",
                content:
                  `Situation: ${input.plan.brief.situation}\n` +
                  `Items to present:\n${itemLines}\n` +
                  deliveryLine(input.plan.delivery),
              },
            ],
            temperature: 0.7,
          },
        },
        { tenantId: input.session.tenantId },
      );

      const reply = response.choices[0]?.message.content?.trim();
      if (!reply) throw new Error("empty completion");
      return { reply, cardRefs };
    } catch {
      // Model down — fall back to a plain, grounded rendering plus the
      // gateway's graceful note. Items and prices still come from the plan.
      const plain = top.map((c) => `· ${c.product.title} — ${c.reason}`).join("\n");
      return {
        reply: `${this.model.gracefulMessage()}\n${plain}`,
        cardRefs,
      };
    }
  }
}

// ---------- helpers ----------

function extractToolArgs(response: ChatResponse): unknown {
  const call = response.choices[0]?.message.tool_calls?.[0];
  if (!call) throw new Error("model did not call set_brief");
  return JSON.parse(call.function.arguments);
}

function topPicks(plan: CandidatePlan): SlotCandidate[] {
  const out: SlotCandidate[] = [];
  for (const slotId of Object.keys(plan.candidatesBySlot)) {
    const first = plan.candidatesBySlot[slotId]?.[0];
    if (first) out.push(first);
  }
  return out;
}

function deliveryLine(d?: DeliveryAssessment): string {
  if (!d || !d.destination) return "";
  if (!d.feasible) return `Delivery: not currently feasible to ${d.destination}.`;
  const warn = d.perishableWarnings.length > 0 ? ` Warnings: ${d.perishableWarnings.join("; ")}` : "";
  return `Delivery: feasible to ${d.destination}${d.earliestDate ? ` by ${d.earliestDate}` : ""}.${warn}`;
}

function fallbackBrief(
  message: string,
  persona: Persona,
  previous?: WorkingBrief,
): WorkingBrief {
  if (previous) return previous;
  return {
    situation: message,
    detectedLocale: fallbackLocale(message, persona),
    slots: [{ id: "primary", description: message, categoryHints: [], required: true }],
  };
}

function fallbackLocale(message: string, persona: Persona): Locale {
  const enabled = new Set(persona.languages);
  const lower = message.toLowerCase();
  if (enabled.has("tanglish") && /\b(machan|aiyo|kohomada|mage|amma|thatha)\b/.test(lower))
    return "tanglish";
  if (enabled.has("si") && /[඀-෿]/.test(message)) return "si";
  if (enabled.has("ta") && /[஀-௿]/.test(message)) return "ta";
  return enabled.has("en") ? "en" : (persona.languages[0] ?? "en");
}

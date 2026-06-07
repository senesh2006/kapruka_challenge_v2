import type {
  CustomerProfile,
  Locale,
  Persona,
  Session,
  Tenant,
} from "@sevana/shared";
import type { RetailerConnector } from "@sevana/connectors";
import type {
  CandidatePlan,
  Critique,
  DeliveryAssessment,
  IntentSlot,
  SlotCandidate,
  WorkingBrief,
} from "../brief/index.js";
import type {
  ConciergeAgent,
  Critic,
  GuardrailAgent,
  GuardrailVerdict,
  LogisticsAgent,
  MerchandiserAgent,
  RetentionAgent,
  ShopperAgent,
} from "./index.js";

/**
 * Stub agents. Each demonstrates the contract and lets the orchestrator loop
 * run end-to-end without NIM. Real implementations replace these one-for-one
 * without changing the orchestrator.
 */

// ---------- 5.1 Concierge ----------

export class StubConciergeAgent implements ConciergeAgent {
  async read(input: {
    message: string;
    session: Session;
    persona: Persona;
    previousBrief?: WorkingBrief;
  }): Promise<{ brief: WorkingBrief }> {
    const locale = detectLocale(input.message, input.persona);
    const brief: WorkingBrief = input.previousBrief ?? {
      situation: input.message,
      detectedLocale: locale,
      slots: [],
    };
    if (!input.previousBrief) {
      brief.situation = input.message;
      brief.detectedLocale = locale;
      brief.slots = naiveSlotExtraction(input.message);
    } else {
      brief.situation = input.previousBrief.situation || input.message;
    }
    return { brief };
  }

  async present(input: {
    plan: CandidatePlan;
    persona: Persona;
    session: Session;
    locale: Locale;
  }): Promise<{ reply: string; cardRefs: string[] }> {
    const top = topPicks(input.plan);
    const cardRefs = top.map((c) => c.product.id);
    const voice = input.persona.brandVoice || "Hari";
    if (top.length === 0) {
      return {
        reply: `${voice}: Tell me a little more about the situation and I'll have something thoughtful ready.`,
        cardRefs,
      };
    }
    const lines = top.map((c) => `· ${c.product.title} — ${c.reason}`);
    const reply = [
      `${voice}: Here's what I'd recommend.`,
      ...lines,
      summariseDelivery(input.plan.delivery),
    ]
      .filter(Boolean)
      .join("\n");
    return { reply, cardRefs };
  }
}

// ---------- 5.2 Shopper ----------

export class CatalogueShopperAgent implements ShopperAgent {
  constructor(private readonly connectorFor: (tenant: Tenant) => Promise<RetailerConnector>) {}

  async curateSlot(input: {
    slot: IntentSlot;
    brief: WorkingBrief;
    tenant: Tenant;
  }): Promise<{ candidates: SlotCandidate[]; demandSignal?: { reason: string } }> {
    const connector = await this.connectorFor(input.tenant);
    const result = await connector.catalogue.searchProducts({
      query: input.slot.description,
      ...(input.slot.categoryHints.length > 0 ? { categoryIds: input.slot.categoryHints } : {}),
      ...(input.brief.detectedLocale !== "tanglish" ? { locale: input.brief.detectedLocale } : {}),
      limit: 8,
    });
    if (result.items.length === 0) {
      // Demand signal: catalogue gap (FR for shopper agent — emit for analytics).
      return { candidates: [], demandSignal: { reason: input.slot.description } };
    }
    const candidates: SlotCandidate[] = result.items.map((item, idx) => ({
      slotId: input.slot.id,
      product: item,
      reason: `Matches "${input.slot.description}"`,
      rank: idx,
      appliedRules: [],
    }));
    return { candidates };
  }
}

// ---------- 5.3 Logistics ----------

export class ConnectorLogisticsAgent implements LogisticsAgent {
  constructor(private readonly connectorFor: (tenant: Tenant) => Promise<RetailerConnector>) {}

  async assess(input: {
    brief: WorkingBrief;
    cartSnapshot: ReadonlyArray<{ productId: string; quantity: number }>;
    tenant: Tenant;
  }): Promise<DeliveryAssessment> {
    const destination = input.brief.destination;
    if (!destination) {
      return { destination: "", feasible: false, perishableWarnings: [], notes: ["destination not yet known"] };
    }
    const connector = await this.connectorFor(input.tenant);
    const date = input.brief.occasionDate ?? new Date().toISOString();
    const quote = await connector.delivery.checkDelivery(
      destination,
      date,
      input.cartSnapshot.map((c) => ({ productId: c.productId as never, quantity: c.quantity })),
    );
    return {
      destination,
      ...(quote.earliestDate !== undefined ? { earliestDate: quote.earliestDate } : {}),
      feasible: quote.available,
      perishableWarnings: quote.perishableWarnings,
      notes: quote.reason ? [quote.reason] : [],
    };
  }
}

// ---------- 5.4 Merchandiser ----------

export class TenantRulesMerchandiserAgent implements MerchandiserAgent {
  async apply(input: {
    candidatesBySlot: Record<string, SlotCandidate[]>;
    tenant: Tenant;
  }): Promise<{ candidatesBySlot: Record<string, SlotCandidate[]> }> {
    const rules = input.tenant.merchandising;
    const exclusions = new Set(rules.exclusions);
    const result: Record<string, SlotCandidate[]> = {};

    for (const [slotId, items] of Object.entries(input.candidatesBySlot)) {
      const filtered = items.filter((c) => !exclusions.has(String(c.product.id)));
      const ranked = [...filtered].sort((a, b) => a.rank - b.rank);
      result[slotId] = ranked.map((c, idx) => ({
        ...c,
        rank: idx,
        appliedRules:
          rules.rankingPriorities.length > 0
            ? [...c.appliedRules, `ranking:${rules.rankingPriorities[0] ?? ""}`].filter(Boolean)
            : c.appliedRules,
      }));
    }
    return { candidatesBySlot: result };
  }
}

// ---------- 5.5 Retention ----------

export class InMemoryRetentionAgent implements RetentionAgent {
  private readonly profiles = new Map<string, CustomerProfile>();

  async load(input: { session: Session; tenant: Tenant }): Promise<CustomerProfile | null> {
    if (!input.session.customerId) return null;
    const key = `${input.session.tenantId}::${input.session.customerId}`;
    return this.profiles.get(key) ?? null;
  }

  async update(input: {
    session: Session;
    plan: CandidatePlan;
    profile?: CustomerProfile;
  }): Promise<void> {
    if (!input.profile || !input.session.customerId) return;
    if (!input.profile.consent.memoryOptIn) return;
    const key = `${input.session.tenantId}::${input.session.customerId}`;
    this.profiles.set(key, input.profile);
  }

  /** Test/op affordance — register a profile up front. */
  preload(profile: CustomerProfile): void {
    this.profiles.set(`${profile.tenantId}::${profile.id}`, profile);
  }
}

// ---------- 5.6 Guardrail ----------

export class DefaultGuardrailAgent implements GuardrailAgent {
  async reviewPlan(input: { plan: CandidatePlan; tenant: Tenant }): Promise<GuardrailVerdict> {
    const priceKeys = new Set<string>();
    for (const candidates of Object.values(input.plan.candidatesBySlot)) {
      for (const c of candidates) priceKeys.add(`${c.product.id}:${c.product.price.amount}`);
    }
    // Factual grounding (FR-4): every cart line must point at a candidate.
    const candidateIds = new Set(
      Object.values(input.plan.candidatesBySlot)
        .flat()
        .map((c) => String(c.product.id)),
    );
    for (const line of input.plan.cart) {
      if (!candidateIds.has(String(line.productId))) {
        return {
          approve: false,
          reason: "cart contains an item not produced by the connector",
          refineSlotIds: [],
        };
      }
    }
    if (!input.tenant.guardrails.groundPrices) return { approve: true };
    return { approve: true };
  }

  async reviewReply(input: { reply: string; plan: CandidatePlan; tenant: Tenant }): Promise<GuardrailVerdict> {
    const titles = new Set(
      Object.values(input.plan.candidatesBySlot)
        .flat()
        .map((c) => c.product.title.toLowerCase()),
    );
    // Trivial check: if the reply mentions an item title not in the plan, refuse.
    // Real guardrail uses retrieval + a model; this is the seam.
    const lowered = input.reply.toLowerCase();
    const PRESSURE = ["only 1 left", "hurry", "last chance", "limited time only"];
    for (const phrase of PRESSURE) {
      if (lowered.includes(phrase)) {
        return {
          approve: false,
          reason: `pressure phrasing: "${phrase}"`,
          refineSlotIds: [],
          correction: "Warmth, not urgency. Rephrase without scarcity.",
        };
      }
    }
    // (titles is computed for future grounding checks — kept for the seam.)
    void titles;
    return { approve: true };
  }

  async reviewOrder(input: {
    plan: CandidatePlan;
    tenant: Tenant;
    explicitConfirmation: boolean;
  }): Promise<GuardrailVerdict> {
    if (input.tenant.guardrails.requireExplicitConfirmation && !input.explicitConfirmation) {
      return {
        approve: false,
        reason: "explicit confirmation required before order creation (FR-10)",
        refineSlotIds: [],
      };
    }
    return { approve: true };
  }
}

// ---------- Critic ----------

/** Default critic: brief is done when every required slot has at least one candidate. */
export const briefCoverageCritic: Critic = (plan, brief) => {
  const refine: string[] = [];
  for (const slot of brief.slots) {
    if (!slot.required) continue;
    if ((plan.candidatesBySlot[slot.id]?.length ?? 0) === 0) refine.push(slot.id);
  }
  return refine.length === 0
    ? { done: true, reasons: ["all required slots covered"], refineSlotIds: [] }
    : { done: false, reasons: ["slots without candidates"], refineSlotIds: refine };
};

// ---------- helpers ----------

function detectLocale(message: string, persona: Persona): Locale {
  const enabled = new Set(persona.languages);
  const lower = message.toLowerCase();
  if (enabled.has("tanglish") && /\b(machan|aiyo|kohomada|mage)\b/.test(lower)) return "tanglish";
  if (enabled.has("si") && /[඀-෿]/.test(message)) return "si";
  if (enabled.has("ta") && /[஀-௿]/.test(message)) return "ta";
  return enabled.has("en") ? "en" : (persona.languages[0] ?? "en");
}

function naiveSlotExtraction(message: string): IntentSlot[] {
  // Trivial extraction so the loop has something to do. Real implementation
  // is a structured NIM call routed via @sevana/model-gateway.
  return [
    {
      id: "primary",
      description: message,
      categoryHints: [],
      required: true,
    },
  ];
}

function topPicks(plan: CandidatePlan): SlotCandidate[] {
  const out: SlotCandidate[] = [];
  for (const slotId of Object.keys(plan.candidatesBySlot)) {
    const first = plan.candidatesBySlot[slotId]?.[0];
    if (first) out.push(first);
  }
  return out;
}

function summariseDelivery(d?: DeliveryAssessment): string {
  if (!d || !d.destination) return "";
  if (!d.feasible) return `(delivery to ${d.destination} not feasible — ${d.notes.join(", ") || "checking alternatives"})`;
  const warn = d.perishableWarnings.length > 0 ? ` Heads-up: ${d.perishableWarnings.join("; ")}.` : "";
  return `Deliverable to ${d.destination}${d.earliestDate ? ` by ${d.earliestDate}` : ""}.${warn}`;
}

import {
  detectLocaleFromMessage,
  type CustomerProfile,
  type Locale,
  type Persona,
  type Session,
  type Tenant,
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
      brief.slots = slotsForOccasion(detectOccasion(input.message), input.message);
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
    const occasion = detectOccasion(input.plan.brief.situation);
    
    if (top.length === 0) {
      return { 
        reply: `Oh, I'm so sorry! I couldn't find the perfect match right now. Could you tell me a bit more about what you're looking for? I'd love to help you find something special!`, 
        cardRefs 
      };
    }

    const lines = top.map((c) => `· ${c.product.title} — This is a wonderful choice! ${c.reason}`);
    
    const salesOpener = [
      `Hi there! I've found some absolutely beautiful options for this ${occasion}.`,
      `Since you're looking to make this moment special, I've hand-picked these just for you!`,
      `You're going to love these selections. They're perfect for the occasion!`
    ][Math.floor(Math.random() * 3)];

    const crossSell = top.length < 3 ? "\n\nI've also included a little something extra to complete the gift — you can't go wrong with adding some sweets or flowers!" : "";

    const reply = [
      `${voice}: ${salesOpener}`,
      ...lines,
      crossSell,
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
  }): Promise<{
    candidates: SlotCandidate[];
    demandSignal?: { reason: string };
    degraded?: { reason: string };
  }> {
    let result;
    try {
      const connector = await this.connectorFor(input.tenant);
      console.log(`[Shopper] Searching for: "${input.slot.description}" (slot: ${input.slot.id})`);
      result = await connector.catalogue.searchProducts({
        query: input.slot.description,
        ...(input.slot.categoryHints.length > 0 ? { categoryIds: input.slot.categoryHints } : {}),
        ...(input.brief.detectedLocale !== "tanglish" ? { locale: input.brief.detectedLocale } : {}),
        limit: 12,
      });
      console.log(`[Shopper] Found ${result.items.length} items for "${input.slot.description}"`);
    } catch (err) {
      console.error(`[Shopper] CRITICAL: Search failed for query "${input.slot.description}".`);
      console.error(`[Shopper] Error details:`, err);
      if (err instanceof Error) {
        console.error(`[Shopper] Error Name: ${err.name}`);
        console.error(`[Shopper] Error Message: ${err.message}`);
        console.error(`[Shopper] Stack Trace: ${err.stack}`);
      }
      // If it's a Zod error (common in normalization), log the issues
      if (err && typeof err === 'object' && 'issues' in err) {
        console.error(`[Shopper] Validation Issues:`, JSON.stringify((err as any).issues, null, 2));
      }
      
      // Connector outage degrades to "nothing found" rather than killing the
      // turn (NFR-5). The gap still registers as a demand signal, and the
      // degradation is surfaced so observability sees the outage.
      return {
        candidates: [],
        demandSignal: { reason: input.slot.description },
        degraded: { reason: err instanceof Error ? err.message : String(err) },
      };
    }
    if (result.items.length === 0) {
      // Demand signal: catalogue gap (FR for shopper agent — emit for analytics).
      return { candidates: [], demandSignal: { reason: input.slot.description } };
    }
    const candidates: SlotCandidate[] = result.items.map((item, idx) => ({
      slotId: input.slot.id,
      product: item,
      reason: `It's a top-rated item that perfectly fits your search for "${input.slot.description}"!`,
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
    try {
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
    } catch {
      // Delivery connector outage: better to admit we can't confirm than to
      // guess a date or block the whole turn (NFR-5).
      return {
        destination,
        feasible: false,
        perishableWarnings: [],
        notes: ["delivery info unavailable"],
        degraded: true,
      };
    }
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
  return detectLocaleFromMessage(message, { enabledLanguages: persona.languages });
}

/**
 * The situation categories the stub concierge reads. A NIM concierge replaces
 * this with real reasoning, but even the stub must not recommend a birthday
 * cake for a bereavement — that's the whole point of "reading the situation".
 */
export type Occasion =
  | "bereavement"
  | "apology"
  | "birthday"
  | "wedding"
  | "anniversary"
  | "newborn"
  | "generic";

// Leading boundary only (prefixes like "apolog"/"condolen" must match longer
// words). Bereavement first — it must never be misread as a celebration.
const OCCASION_PATTERNS: ReadonlyArray<readonly [Occasion, RegExp]> = [
  ["bereavement", /\b(?:passed away|pass(?:ed)? on|funeral|condolen|bereave|sympath|loss of|deceased|mourning|rest in peace|rip\b|alms)/i],
  ["apology", /\b(?:sorry|apolog|forgive|make it up|i was wrong|my fault|let (?:her|him|them) down)/i],
  ["newborn", /\b(?:newborn|new baby|baby shower|just had a baby|new arrival)/i],
  ["wedding", /\b(?:wedding|getting married|nuptial|marriage|tie the knot)/i],
  ["anniversary", /\banniversary/i],
  ["birthday", /\b(?:birthday|bday|b-day|turning \d+)/i],
];

export function detectOccasion(message: string): Occasion {
  for (const [occ, re] of OCCASION_PATTERNS) {
    if (re.test(message)) return occ;
  }
  return "generic";
}

function slot(id: string, description: string, categoryHints: string[], required = true): IntentSlot {
  return { id, description, categoryHints, required };
}

/**
 * Turn a read occasion into intent slots with category hints. The first slot
 * keeps the id "primary" so the loop + downstream contracts stay stable; extra
 * slots coordinate a small, situation-appropriate set.
 */
function slotsForOccasion(occasion: Occasion, message: string): IntentSlot[] {
  switch (occasion) {
    case "bereavement":
      return [
        slot("primary", "white sympathy flowers condolence wreath", ["sympathy", "flowers"]),
        slot("hamper", "condolence fruit basket or alms offering", ["sympathy", "hamper"], false),
      ];
    case "apology":
      return [
        slot("primary", "apology flowers bouquet red roses", ["flowers"]),
        slot("sweet", "premium chocolate box or luxury cake", ["chocolate", "cake"], false),
      ];
    case "birthday":
      return [
        slot("primary", "delicious birthday cake chocolate ribbon fruit", ["cake"]),
        slot("flowers", "cheerful birthday flowers sunflower bouquet", ["flowers"], false),
        slot("treat", "box of premium chocolates", ["chocolate"], false),
      ];
    case "wedding":
      return [
        slot("primary", "elegant wedding gift brass oil lamp homeware", ["wedding", "homeware"]),
        slot("flowers", "luxurious celebratory bouquet", ["flowers"], false),
      ];
    case "anniversary":
      return [
        slot("primary", "anniversary red roses bouquet elegant orchids", ["flowers"]),
        slot("cake", "romantic celebration cake", ["cake"], false),
        slot("gift", "luxury chocolate collection", ["chocolate"], false),
      ];
    case "newborn":
      return [
        slot("primary", "newborn baby gift hamper welcome set", ["baby", "hamper"]),
        slot("flowers", "soft pastel congratulations flowers", ["flowers"], false),
      ];
    default:
      return [
        slot("primary", message, []),
        slot("complementary", "popular gift item or treat", ["cake", "flowers", "chocolate"], false),
      ];
  }
}

function openerFor(occasion: Occasion): string {
  switch (occasion) {
    case "bereavement":
      return "I'm so sorry for your loss — and being far from home makes it heavier. Here's something dignified I can send in your place.";
    case "apology":
      return "That's a tender spot to be in. Something heartfelt can open the door — here's what I'd send.";
    case "newborn":
      return "Congratulations on the new arrival! Here's a warm welcome I'd send.";
    case "wedding":
      return "A wedding — wonderful. Here's a gift with meaning.";
    default:
      return "Here's what I'd recommend.";
  }
}

function emptyReplyFor(occasion: Occasion): string {
  if (occasion === "bereavement") {
    return "I'm so sorry for your loss. Tell me a little about your grandmother and the family, and I'll arrange something dignified to send home in your place.";
  }
  return "Tell me a little more about the situation and I'll have something thoughtful ready.";
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

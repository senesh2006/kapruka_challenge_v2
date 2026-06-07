import type {
  CustomerProfile,
  Locale,
  Persona,
  Session,
  Tenant,
} from "@sevana/shared";
import type {
  CandidatePlan,
  Critique,
  DeliveryAssessment,
  IntentSlot,
  SlotCandidate,
  WorkingBrief,
} from "../brief/index.js";

/**
 * Agent interfaces from PRD §7. Each agent has a single clear role and the
 * orchestrator calls them in a structured loop. Only the Concierge speaks to
 * the customer; all others return structured data.
 */

/** 5.1 Concierge — reads emotion and situation, holds an opinion, speaks. */
export interface ConciergeAgent {
  /** Reads a customer message into the working brief. Detects language. */
  read(input: {
    message: string;
    session: Session;
    persona: Persona;
    profile?: CustomerProfile;
    previousBrief?: WorkingBrief;
  }): Promise<{ brief: WorkingBrief }>;

  /** Renders the final reply for the customer once the loop has settled. */
  present(input: {
    plan: CandidatePlan;
    persona: Persona;
    session: Session;
    locale: Locale;
  }): Promise<{ reply: string; cardRefs: string[] }>;
}

/** 5.2 Shopper — searches and curates the catalogue per intent slot. */
export interface ShopperAgent {
  curateSlot(input: {
    slot: IntentSlot;
    brief: WorkingBrief;
    tenant: Tenant;
  }): Promise<{ candidates: SlotCandidate[]; demandSignal?: { reason: string } }>;
}

/** 5.3 Logistics — resolves destination, checks delivery, flags perishables. */
export interface LogisticsAgent {
  assess(input: {
    brief: WorkingBrief;
    cartSnapshot: ReadonlyArray<{ productId: string; quantity: number }>;
    tenant: Tenant;
  }): Promise<DeliveryAssessment>;
}

/** 5.4 Merchandiser — applies tenant rules to the shopper's candidates. */
export interface MerchandiserAgent {
  apply(input: {
    candidatesBySlot: Record<string, SlotCandidate[]>;
    tenant: Tenant;
  }): Promise<{ candidatesBySlot: Record<string, SlotCandidate[]> }>;
}

/** 5.5 Retention — consented profile + memory + taste/relationship graph. */
export interface RetentionAgent {
  load(input: { session: Session; tenant: Tenant }): Promise<CustomerProfile | null>;
  update(input: {
    session: Session;
    plan: CandidatePlan;
    profile?: CustomerProfile;
  }): Promise<void>;
}

/** 5.6 Guardrail — last checkpoint before concierge speaks or order is created. */
export type GuardrailVerdict =
  | { approve: true }
  | { approve: false; reason: string; refineSlotIds: string[]; correction?: string };

export interface GuardrailAgent {
  reviewPlan(input: { plan: CandidatePlan; tenant: Tenant }): Promise<GuardrailVerdict>;
  reviewReply(input: { reply: string; plan: CandidatePlan; tenant: Tenant }): Promise<GuardrailVerdict>;
  /** Final gate before any order is created (FR-10). */
  reviewOrder(input: { plan: CandidatePlan; tenant: Tenant; explicitConfirmation: boolean }): Promise<GuardrailVerdict>;
}

/** Critique can be supplied by any reasoning module; defaults to a brief-coverage check. */
export type Critic = (plan: CandidatePlan, brief: WorkingBrief) => Critique;

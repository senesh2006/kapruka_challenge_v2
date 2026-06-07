import { z } from "zod";
import {
  BriefSchema as SessionBriefSchema,
  type Brief as SessionBrief,
  type CartLine,
  type Locale,
  MoneySchema,
} from "@sevana/shared";
import type { ProductSummary } from "@sevana/connectors";

/**
 * One discrete shopping need inside a working brief — what the Shopper agent
 * fans out to fulfil. The orchestrator can re-run a single slot when the
 * customer swaps or refines one item (FR-8) without rebuilding the whole plan.
 */
export const IntentSlotSchema = z.object({
  id: z.string().min(1),
  description: z.string(),
  categoryHints: z.array(z.string()).default([]),
  budget: z
    .object({ min: MoneySchema.optional(), max: MoneySchema.optional() })
    .optional(),
  required: z.boolean().default(true),
});
export type IntentSlot = z.infer<typeof IntentSlotSchema>;

/**
 * The orchestrator's working brief. Extends the customer-facing `Session.brief`
 * with internal slots the agents work off of and a candidate plan the loop
 * critiques and refines.
 */
export interface WorkingBrief {
  situation: string;
  recipient?: string;
  destination?: string;
  occasionDate?: string;
  budget?: { min?: number; max?: number; currency: string };
  detectedLocale: Locale;
  slots: IntentSlot[];
}

export interface SlotCandidate {
  slotId: string;
  product: ProductSummary;
  reason: string;
  rank: number;
  appliedRules: string[];
}

export interface DeliveryAssessment {
  destination: string;
  earliestDate?: string;
  feasible: boolean;
  perishableWarnings: string[];
  notes: string[];
}

export interface CandidatePlan {
  brief: WorkingBrief;
  candidatesBySlot: Record<string, SlotCandidate[]>;
  delivery?: DeliveryAssessment;
  cart: CartLine[];
}

export interface Critique {
  done: boolean;
  reasons: string[];
  refineSlotIds: string[];
}

export function emptyBrief(situation: string, locale: Locale): WorkingBrief {
  return { situation, detectedLocale: locale, slots: [] };
}

export function emptyPlan(brief: WorkingBrief): CandidatePlan {
  return { brief, candidatesBySlot: {}, cart: [] };
}

/** Convert the orchestrator's WorkingBrief back to the customer-facing Session brief. */
export function toSessionBrief(brief: WorkingBrief): SessionBrief {
  const result = SessionBriefSchema.parse({
    constraints: brief.slots.map((s) => s.description),
    ...(brief.situation ? { situation: brief.situation } : {}),
    ...(brief.recipient ? { recipient: brief.recipient } : {}),
    ...(brief.occasionDate ? { occasionDate: brief.occasionDate } : {}),
    ...(brief.budget?.max !== undefined ? { budget: brief.budget.max } : {}),
  });
  return result;
}

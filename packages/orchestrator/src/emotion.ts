import type { CandidatePlan, WorkingBrief } from "./brief/index.js";

/**
 * The concierge's emotional register for a turn — used to drive the avatar's
 * facial expression and motion so Hari reads as a warm, situation-aware
 * character rather than a chat box (the "best buddy" bar).
 */
export type ConciergeEmotion =
  | "neutral"
  | "warm"
  | "excited"
  | "thoughtful"
  | "apologetic"
  | "celebratory"
  | "condolence";

// Bereavement must win over everything — a death is never a "celebration",
// even if the message also mentions a relative or a date.
// Leading word-boundary only — these are prefixes ("apolog" must match
// "apologise", "condolen" must match "condolence"), so no trailing \b.
const BEREAVEMENT =
  /\b(?:passed away|pass(?:ed)? on|funeral|condolen|bereave|sympath|loss of|deceased|mourning|rest in peace|rip\b|alms)/i;
const APOLOGY = /\b(?:sorry|apolog|forgive|make it up|missed|couldn'?t be there|can'?t be there|i was wrong|my fault)/i;
const CELEBRATION = /\b(?:birthday|wedding|anniversary|congratulat|graduat|newborn|baby|festival|avurudu|poson|vesak|deepavali|diwali|christmas)/i;
const GIFT = /\b(?:gift|surprise|treat|spoil|love|miss you|thinking of you)/i;

/**
 * Heuristic emotion derivation from the situation + the concierge's reply.
 *
 * Deliberately a fast keyword pass for now — a NIM-backed concierge can return
 * an explicit emotion tag later and this becomes the fallback. The avatar
 * layer only needs a stable enum, so the source can change without touching
 * the frontend.
 */
export function deriveEmotion(input: {
  reply: string;
  brief: WorkingBrief;
  plan: CandidatePlan;
}): ConciergeEmotion {
  const haystack = `${input.brief.situation} ${input.reply}`;
  const hasItems = Object.values(input.plan.candidatesBySlot).some((c) => c.length > 0);

  // Sensitive situations take priority over celebratory/commerce cues.
  if (BEREAVEMENT.test(haystack)) return "condolence";
  if (APOLOGY.test(haystack)) return "apologetic";
  if (CELEBRATION.test(haystack)) return "celebratory";
  if (hasItems && GIFT.test(haystack)) return "excited";
  if (hasItems) return "warm";
  // No items yet — she's still reading the situation, gathering.
  return "thoughtful";
}

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
  | "celebratory";

const APOLOGY = /\b(sorry|apolog|forgive|make it up|missed|couldn'?t be there|can'?t be there)\b/i;
const CELEBRATION = /\b(birthday|wedding|anniversary|congratulat|graduat|newborn|baby|festival|avurudu|poson|vesak|deepavali|diwali|christmas)\b/i;
const GIFT = /\b(gift|surprise|treat|spoil|love|miss you|thinking of you)\b/i;

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

  if (APOLOGY.test(haystack)) return "apologetic";
  if (CELEBRATION.test(haystack)) return "celebratory";
  if (hasItems && GIFT.test(haystack)) return "excited";
  if (hasItems) return "warm";
  // No items yet — she's still reading the situation, gathering.
  return "thoughtful";
}

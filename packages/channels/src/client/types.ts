import { z } from "zod";

/** Wire types for /api/turn. Mirror the JSON the route returns. */

export const ChannelKindSchema = z.enum([
  "widget",
  "full-page",
  "mobile-sdk",
  "messaging-whatsapp",
]);
export type ChannelKind = z.infer<typeof ChannelKindSchema>;

export const TurnRequestSchema = z.object({
  sessionId: z.string().min(1),
  message: z.string().min(1),
});
export type TurnRequest = z.infer<typeof TurnRequestSchema>;

export const MoneySchema = z.object({
  amount: z.number(),
  currency: z.string(),
});
export type Money = z.infer<typeof MoneySchema>;

export const RecommendedCardSchema = z.object({
  productId: z.string(),
  title: z.string(),
  imageUrl: z.string(),
  price: MoneySchema,
  reason: z.string(),
  slotId: z.string().optional(),
  renderUrl: z.string().optional(),
  renderDegraded: z.boolean().optional(),
  isHero: z.boolean().optional(),
});
export type RecommendedCard = z.infer<typeof RecommendedCardSchema>;

export const ConciergeEmotionSchema = z.enum([
  "neutral",
  "warm",
  "excited",
  "thoughtful",
  "apologetic",
  "celebratory",
  "condolence",
]);
export type ConciergeEmotion = z.infer<typeof ConciergeEmotionSchema>;

export const TurnResponseSchema = z.object({
  sessionId: z.string(),
  reply: z.string(),
  cardRefs: z.array(z.string()).default([]),
  cards: z.array(RecommendedCardSchema).default([]),
  emotion: ConciergeEmotionSchema.default("warm"),
  guardrailVerdict: z.enum(["approved", "blocked"]),
  detectedLocale: z.enum(["en", "si", "ta", "tanglish"]).optional(),
  at: z.string(),
});
export type TurnResponse = z.infer<typeof TurnResponseSchema>;

/** A single rendered turn the UI stores client-side. */
export interface ConversationTurn {
  id: string;
  role: "customer" | "concierge" | "system";
  content: string;
  cardRefs?: string[];
  cards?: RecommendedCard[];
  at: string;
  status?: "pending" | "delivered" | "blocked";
}

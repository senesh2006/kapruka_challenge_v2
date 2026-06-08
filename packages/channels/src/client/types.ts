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

export const TurnResponseSchema = z.object({
  sessionId: z.string(),
  reply: z.string(),
  cardRefs: z.array(z.string()).default([]),
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
  at: string;
  status?: "pending" | "delivered" | "blocked";
}

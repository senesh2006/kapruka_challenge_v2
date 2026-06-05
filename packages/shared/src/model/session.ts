import { z } from "zod";
import {
  ChannelSchema,
  CustomerIdSchema,
  LocaleSchema,
  MoneySchema,
  ProductIdSchema,
  SessionIdSchema,
  TenantIdSchema,
} from "./primitives.js";

export const MessageRoleSchema = z.enum(["customer", "concierge", "system"]);
export type MessageRole = z.infer<typeof MessageRoleSchema>;

export const ConversationTurnSchema = z.object({
  role: MessageRoleSchema,
  content: z.string(),
  at: z.string().datetime(),
});
export type ConversationTurn = z.infer<typeof ConversationTurnSchema>;

export const ConversationStateSchema = z.enum([
  "greeting",
  "gathering",
  "recommending",
  "refining",
  "confirming",
  "checkout",
  "tracking",
  "ended",
]);
export type ConversationState = z.infer<typeof ConversationStateSchema>;

export const BriefSchema = z.object({
  situation: z.string().optional(),
  recipient: z.string().optional(),
  budget: z.number().nonnegative().optional(),
  occasionDate: z.string().datetime().optional(),
  constraints: z.array(z.string()).default([]),
});
export type Brief = z.infer<typeof BriefSchema>;

export const CartLineSchema = z.object({
  productId: ProductIdSchema,
  quantity: z.number().int().positive(),
  unitPrice: MoneySchema,
  reason: z.string().optional(),
});
export type CartLine = z.infer<typeof CartLineSchema>;

export const SessionSchema = z.object({
  id: SessionIdSchema,
  tenantId: TenantIdSchema,
  customerId: CustomerIdSchema.optional(),
  channel: ChannelSchema,
  locale: LocaleSchema.optional(),
  state: ConversationStateSchema.default("greeting"),
  brief: BriefSchema.default({ constraints: [] }),
  transcript: z.array(ConversationTurnSchema).default([]),
  cart: z.array(CartLineSchema).default([]),
  startedAt: z.string().datetime(),
  lastTouchedAt: z.string().datetime(),
});
export type Session = z.infer<typeof SessionSchema>;

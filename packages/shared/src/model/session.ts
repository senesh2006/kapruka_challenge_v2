import { z } from "zod";
import {
  ChannelSchema,
  CustomerIdSchema,
  LocaleSchema,
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

export const BriefSchema = z.object({
  situation: z.string().optional(),
  recipient: z.string().optional(),
  budget: z.number().nonnegative().optional(),
  occasionDate: z.string().datetime().optional(),
  constraints: z.array(z.string()).default([]),
});
export type Brief = z.infer<typeof BriefSchema>;

export const SessionSchema = z.object({
  id: SessionIdSchema,
  tenantId: TenantIdSchema,
  customerId: CustomerIdSchema.optional(),
  channel: ChannelSchema,
  locale: LocaleSchema.optional(),
  brief: BriefSchema.default({ constraints: [] }),
  transcript: z.array(ConversationTurnSchema).default([]),
  cartItemIds: z.array(z.string()).default([]),
  startedAt: z.string().datetime(),
  lastTouchedAt: z.string().datetime(),
});
export type Session = z.infer<typeof SessionSchema>;

import { z } from "zod";
import {
  CustomerIdSchema,
  OrderIdSchema,
  SessionIdSchema,
  TenantIdSchema,
} from "./primitives.js";

const BaseEventSchema = z.object({
  id: z.string(),
  tenantId: TenantIdSchema,
  at: z.string().datetime(),
});

export const ConversationEventSchema = BaseEventSchema.extend({
  kind: z.literal("conversation"),
  sessionId: SessionIdSchema,
  customerId: CustomerIdSchema.optional(),
  turnRole: z.enum(["customer", "concierge"]),
  contentLength: z.number().int().nonnegative(),
});
export type ConversationEvent = z.infer<typeof ConversationEventSchema>;

export const RecommendationEventSchema = BaseEventSchema.extend({
  kind: z.literal("recommendation"),
  sessionId: SessionIdSchema,
  recommendationId: z.string(),
  itemCount: z.number().int().positive(),
});
export type RecommendationEvent = z.infer<typeof RecommendationEventSchema>;

export const OrderEventSchema = BaseEventSchema.extend({
  kind: z.literal("order"),
  sessionId: SessionIdSchema,
  orderId: OrderIdSchema,
  status: z.enum(["created", "confirmed", "cancelled"]),
});
export type OrderEvent = z.infer<typeof OrderEventSchema>;

export const PaymentEventSchema = BaseEventSchema.extend({
  kind: z.literal("payment"),
  orderId: OrderIdSchema,
  status: z.enum(["initiated", "succeeded", "failed"]),
});
export type PaymentEvent = z.infer<typeof PaymentEventSchema>;

export const FulfilmentEventSchema = BaseEventSchema.extend({
  kind: z.literal("fulfilment"),
  orderId: OrderIdSchema,
  status: z.enum(["packed", "dispatched", "delivered", "failed"]),
});
export type FulfilmentEvent = z.infer<typeof FulfilmentEventSchema>;

export const EventSchema = z.discriminatedUnion("kind", [
  ConversationEventSchema,
  RecommendationEventSchema,
  OrderEventSchema,
  PaymentEventSchema,
  FulfilmentEventSchema,
]);
export type Event = z.infer<typeof EventSchema>;

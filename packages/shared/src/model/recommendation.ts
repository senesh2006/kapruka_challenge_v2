import { z } from "zod";
import { MoneySchema, ProductIdSchema, SessionIdSchema, TenantIdSchema } from "./primitives.js";

export const RecommendedItemSchema = z.object({
  productId: ProductIdSchema,
  title: z.string(),
  imageUrl: z.string().url(),
  price: MoneySchema,
  reason: z.string(),
});
export type RecommendedItem = z.infer<typeof RecommendedItemSchema>;

export const RecommendationSchema = z.object({
  id: z.string(),
  tenantId: TenantIdSchema,
  sessionId: SessionIdSchema,
  kind: z.enum(["single", "look"]),
  items: z.array(RecommendedItemSchema).min(1),
  rationale: z.string(),
  heroImageUrl: z.string().url().optional(),
  createdAt: z.string().datetime(),
});
export type Recommendation = z.infer<typeof RecommendationSchema>;

export const LookSchema = RecommendationSchema.extend({
  kind: z.literal("look"),
});
export type Look = z.infer<typeof LookSchema>;

import { z } from "zod";
import { MoneySchema, ProductIdSchema, SessionIdSchema, TenantIdSchema } from "./primitives.js";

export const RecommendedItemSchema = z.object({
  productId: ProductIdSchema,
  title: z.string(),
  /** Flat catalogue image — always present; the safe fallback (FR-7 / NFR-5). */
  imageUrl: z.string().url(),
  price: MoneySchema,
  reason: z.string(),
  /** Slot the candidate was curated for, when known. */
  slotId: z.string().optional(),
  /** On-model try-on render URL when the try-on service succeeded. */
  renderUrl: z.string().url().optional(),
  /** True when the try-on render failed and we fell back to `imageUrl`. */
  renderDegraded: z.boolean().optional(),
  /** First card per recommendation gets `isHero: true` — that's the one
   *  rendered live; others use pre-generated or flat images (NFR-3). */
  isHero: z.boolean().optional(),
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

import { z } from "zod";
import { CustomerIdSchema, LocaleSchema, TenantIdSchema } from "./primitives.js";

export const RelationshipSchema = z.object({
  name: z.string(),
  relation: z.string(),
  importantDates: z.array(z.string().datetime()).default([]),
  notes: z.string().optional(),
});
export type Relationship = z.infer<typeof RelationshipSchema>;

export const SizeProfileSchema = z.object({
  shirt: z.string().optional(),
  trouser: z.string().optional(),
  shoe: z.string().optional(),
  dress: z.string().optional(),
  custom: z.record(z.string()).default({}),
});
export type SizeProfile = z.infer<typeof SizeProfileSchema>;

export const TastePreferencesSchema = z.object({
  colours: z.array(z.string()).default([]),
  styles: z.array(z.string()).default([]),
  dislikes: z.array(z.string()).default([]),
  cuisines: z.array(z.string()).default([]),
});
export type TastePreferences = z.infer<typeof TastePreferencesSchema>;

export const ConsentSchema = z.object({
  memoryOptIn: z.boolean(),
  marketingOptIn: z.boolean(),
  capturedAt: z.string().datetime(),
});
export type Consent = z.infer<typeof ConsentSchema>;

export const CustomerProfileSchema = z.object({
  id: CustomerIdSchema,
  tenantId: TenantIdSchema,
  displayName: z.string().optional(),
  locale: LocaleSchema.optional(),
  consent: ConsentSchema,
  preferences: TastePreferencesSchema.default({
    colours: [],
    styles: [],
    dislikes: [],
    cuisines: [],
  }),
  sizes: SizeProfileSchema.optional(),
  relationships: z.array(RelationshipSchema).default([]),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type CustomerProfile = z.infer<typeof CustomerProfileSchema>;

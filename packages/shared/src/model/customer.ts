import { z } from "zod";
import {
  CustomerIdSchema,
  LocaleSchema,
  OrderIdSchema,
  SessionIdSchema,
  TenantIdSchema,
} from "./primitives.js";

export const ConsentSchema = z.object({
  memoryOptIn: z.boolean(),
  marketingOptIn: z.boolean(),
  capturedAt: z.string().datetime(),
});
export type Consent = z.infer<typeof ConsentSchema>;

export const ConsentedIdentitySchema = z.object({
  displayName: z.string().optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
});
export type ConsentedIdentity = z.infer<typeof ConsentedIdentitySchema>;

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

export const TasteGraphNodeKindSchema = z.enum([
  "person",
  "taste",
  "category",
  "brand",
  "occasion",
]);
export type TasteGraphNodeKind = z.infer<typeof TasteGraphNodeKindSchema>;

export const TasteGraphNodeSchema = z.object({
  id: z.string().min(1),
  kind: TasteGraphNodeKindSchema,
  label: z.string(),
  attributes: z.record(z.string()).default({}),
});
export type TasteGraphNode = z.infer<typeof TasteGraphNodeSchema>;

export const TasteGraphEdgeKindSchema = z.enum([
  "prefers",
  "dislikes",
  "related-to",
  "bought-for",
  "occasion-of",
]);
export type TasteGraphEdgeKind = z.infer<typeof TasteGraphEdgeKindSchema>;

export const TasteGraphEdgeSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  kind: TasteGraphEdgeKindSchema,
  weight: z.number().min(0).max(1).default(0.5),
});
export type TasteGraphEdge = z.infer<typeof TasteGraphEdgeSchema>;

export const TasteRelationshipGraphSchema = z.object({
  nodes: z.array(TasteGraphNodeSchema).default([]),
  edges: z.array(TasteGraphEdgeSchema).default([]),
});
export type TasteRelationshipGraph = z.infer<typeof TasteRelationshipGraphSchema>;

export const InteractionHistorySchema = z.object({
  pastOrderIds: z.array(OrderIdSchema).default([]),
  pastSessionIds: z.array(SessionIdSchema).default([]),
  lastSeenAt: z.string().datetime().optional(),
});
export type InteractionHistory = z.infer<typeof InteractionHistorySchema>;

export const CustomerProfileSchema = z.object({
  id: CustomerIdSchema,
  tenantId: TenantIdSchema,
  identity: ConsentedIdentitySchema.default({}),
  locale: LocaleSchema.optional(),
  consent: ConsentSchema,
  preferences: TastePreferencesSchema.default({
    colours: [],
    styles: [],
    dislikes: [],
    cuisines: [],
  }),
  sizes: SizeProfileSchema.optional(),
  tasteGraph: TasteRelationshipGraphSchema.default({ nodes: [], edges: [] }),
  history: InteractionHistorySchema.default({
    pastOrderIds: [],
    pastSessionIds: [],
  }),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type CustomerProfile = z.infer<typeof CustomerProfileSchema>;

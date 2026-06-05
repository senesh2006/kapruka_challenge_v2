import { z } from "zod";
import { ChannelSchema, LocaleSchema, TenantIdSchema } from "./primitives.js";

export const PersonaSchema = z.object({
  brandVoice: z.string(),
  tone: z.array(z.string()).default([]),
  opinions: z.array(z.string()).default([]),
  languages: z.array(LocaleSchema).min(1),
  signatureBehaviours: z.array(z.string()).default([]),
});
export type Persona = z.infer<typeof PersonaSchema>;

export const MerchandisingRulesSchema = z.object({
  promotions: z.array(z.string()).default([]),
  rankingPriorities: z.array(z.string()).default([]),
  substitutions: z.array(z.string()).default([]),
  exclusions: z.array(z.string()).default([]),
  seasonalCampaigns: z.array(z.string()).default([]),
});
export type MerchandisingRules = z.infer<typeof MerchandisingRulesSchema>;

export const GuardrailsSchema = z.object({
  contentSafety: z.boolean().default(true),
  groundPrices: z.boolean().default(true),
  requireExplicitConfirmation: z.boolean().default(true),
  escalationTriggers: z.array(z.string()).default([]),
});
export type Guardrails = z.infer<typeof GuardrailsSchema>;

export const ConnectorBindingsSchema = z.object({
  catalogue: z.string(),
  delivery: z.string(),
  checkout: z.string(),
  crm: z.string().optional(),
});
export type ConnectorBindings = z.infer<typeof ConnectorBindingsSchema>;

export const TenantSchema = z.object({
  id: TenantIdSchema,
  name: z.string(),
  enabledChannels: z.array(ChannelSchema),
  persona: PersonaSchema,
  merchandising: MerchandisingRulesSchema,
  guardrails: GuardrailsSchema,
  connectors: ConnectorBindingsSchema,
  createdAt: z.string().datetime(),
});
export type Tenant = z.infer<typeof TenantSchema>;

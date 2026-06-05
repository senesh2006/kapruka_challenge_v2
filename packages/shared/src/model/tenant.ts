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

export const ConnectorKindSchema = z.enum(["catalogue", "delivery", "checkout", "crm"]);
export type ConnectorKind = z.infer<typeof ConnectorKindSchema>;

export const ConnectorBindingSchema = z.object({
  kind: ConnectorKindSchema,
  adapter: z.string().min(1),
  credentialRef: z.string().min(1),
});
export type ConnectorBinding = z.infer<typeof ConnectorBindingSchema>;

export const ScopedCredentialSchema = z.object({
  ref: z.string().min(1),
  connectorKind: ConnectorKindSchema,
  scopes: z.array(z.string()).default([]),
  rotatedAt: z.string().datetime().optional(),
});
export type ScopedCredential = z.infer<typeof ScopedCredentialSchema>;

export const TenantSchema = z.object({
  id: TenantIdSchema,
  name: z.string(),
  enabledChannels: z.array(ChannelSchema).min(1),
  persona: PersonaSchema,
  merchandising: MerchandisingRulesSchema,
  guardrails: GuardrailsSchema,
  connectors: z.array(ConnectorBindingSchema).min(1),
  credentials: z.array(ScopedCredentialSchema).default([]),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Tenant = z.infer<typeof TenantSchema>;

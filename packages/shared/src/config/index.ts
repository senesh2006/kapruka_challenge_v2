import { z } from "zod";

export const RuntimeConfigSchema = z.object({
  nim: z.object({
    baseUrl: z.string().url(),
    apiKey: z.string().min(1),
    reasoningModel: z.string().min(1),
    visionModel: z.string().min(1),
  }),
  kapruka: z.object({
    mcpBaseUrl: z.string().url().optional(),
    mcpApiKey: z.string().optional(),
  }),
  console: z.object({
    port: z.coerce.number().int().positive().default(3000),
  }),
});
export type RuntimeConfig = z.infer<typeof RuntimeConfigSchema>;

export function loadRuntimeConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  return RuntimeConfigSchema.parse({
    nim: {
      baseUrl: env.NIM_BASE_URL,
      apiKey: env.NIM_API_KEY,
      reasoningModel: env.NIM_REASONING_MODEL,
      visionModel: env.NIM_VISION_MODEL,
    },
    kapruka: {
      mcpBaseUrl: env.KAPRUKA_MCP_BASE_URL,
      mcpApiKey: env.KAPRUKA_MCP_API_KEY,
    },
    console: {
      port: env.CONSOLE_PORT,
    },
  });
}

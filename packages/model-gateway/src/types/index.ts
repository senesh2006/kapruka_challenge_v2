import { z } from "zod";

/**
 * OpenAI-compatible chat-completion types. NIM mirrors this schema so the
 * gateway speaks one shape regardless of which model is selected.
 */

export const MessageRoleSchema = z.enum(["system", "user", "assistant", "tool"]);
export type MessageRole = z.infer<typeof MessageRoleSchema>;

export const TextPartSchema = z.object({ type: z.literal("text"), text: z.string() });
export const ImagePartSchema = z.object({
  type: z.literal("image_url"),
  image_url: z.object({ url: z.string() }),
});
export const ContentPartSchema = z.union([TextPartSchema, ImagePartSchema]);
export type ContentPart = z.infer<typeof ContentPartSchema>;

export const MessageSchema = z.object({
  role: MessageRoleSchema,
  content: z.union([z.string(), z.array(ContentPartSchema)]),
  name: z.string().optional(),
  tool_call_id: z.string().optional(),
});
export type Message = z.infer<typeof MessageSchema>;

export const ToolParameterSchema: z.ZodType<unknown> = z.lazy(() =>
  z.object({
    type: z.string(),
    properties: z.record(z.unknown()).optional(),
    required: z.array(z.string()).optional(),
    description: z.string().optional(),
    enum: z.array(z.unknown()).optional(),
    items: ToolParameterSchema.optional(),
  }),
);

export const ToolDefinitionSchema = z.object({
  type: z.literal("function"),
  function: z.object({
    name: z.string(),
    description: z.string().optional(),
    parameters: z.record(z.unknown()),
  }),
});
export type ToolDefinition = z.infer<typeof ToolDefinitionSchema>;

export const ToolCallSchema = z.object({
  id: z.string(),
  type: z.literal("function"),
  function: z.object({
    name: z.string(),
    arguments: z.string(),
  }),
});
export type ToolCall = z.infer<typeof ToolCallSchema>;

export const ChatRequestSchema = z.object({
  messages: z.array(MessageSchema).min(1),
  temperature: z.number().min(0).max(2).optional(),
  max_tokens: z.number().int().positive().optional(),
  tools: z.array(ToolDefinitionSchema).optional(),
  tool_choice: z.union([z.literal("auto"), z.literal("none"), z.literal("required")]).optional(),
  response_format: z
    .union([
      z.object({ type: z.literal("text") }),
      z.object({ type: z.literal("json_object") }),
    ])
    .optional(),
});
export type ChatRequest = z.infer<typeof ChatRequestSchema>;

export const ChatResponseSchema = z.object({
  id: z.string(),
  model: z.string(),
  created: z.number().int(),
  choices: z
    .array(
      z.object({
        index: z.number().int(),
        finish_reason: z.string(),
        message: z.object({
          role: z.literal("assistant"),
          content: z.string().nullable().optional(),
          tool_calls: z.array(ToolCallSchema).optional(),
        }),
      }),
    )
    .min(1),
  usage: z
    .object({
      prompt_tokens: z.number().int(),
      completion_tokens: z.number().int(),
      total_tokens: z.number().int(),
    })
    .optional(),
});
export type ChatResponse = z.infer<typeof ChatResponseSchema>;

/** Task-shaped request handed to the gateway. The router picks the model. */
export type ModelKind = "reasoning" | "vision";

export interface ModelTaskRequest {
  kind: ModelKind;
  /** Logical task name used for tracing and routing rules. */
  task: string;
  request: ChatRequest;
}

import { z } from "zod";
import { ToolCallEnvelopeSchema } from "./tools.ts";

export const RuntimeMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("GET_ACTIVE_TAB") }),
  z.object({ type: z.literal("GET_SETTINGS") }),
  z.object({
    type: z.literal("TEST_PROVIDER_CONNECTION"),
    provider: z.enum(["openrouter", "openai", "anthropic"]),
    model: z.string().trim().min(1).max(200),
    apiKey: z.string().max(500),
  }),
  z.object({ type: z.literal("GET_TASKS") }),
  z.object({ type: z.literal("GET_AGENT_TASK") }),
  z.object({
    type: z.literal("SAVE_SETTINGS"),
    settings: z.object({
      provider: z.enum(["openrouter", "openai", "anthropic"]),
      apiKey: z.string().max(500),
      model: z.string().trim().min(1).max(200),
      rememberKey: z.boolean(),
      clearKey: z.boolean(),
    }),
  }),
  z.object({ type: z.literal("START_TASK"), goal: z.string().trim().min(1).max(2000) }),
  z.object({ type: z.literal("TASK_CONTROL"), action: z.enum(["run", "pause", "resume", "stop"]) }),
  z.object({ type: z.literal("APPROVE_AGENT_ACTION"), approvalToken: z.string().uuid(), approved: z.boolean() }),
  z.object({ type: z.literal("PROVIDE_AGENT_CLARIFICATION"), answer: z.string().trim().min(1).max(1000) }),
]);
export type RuntimeMessage = z.infer<typeof RuntimeMessageSchema>;

export const RuntimeResponseSchema = z.object({
  success: z.boolean(),
  data: z.unknown().optional(),
  error: z.string().optional(),
});
export type RuntimeResponse = z.infer<typeof RuntimeResponseSchema>;

export const ActiveTabSummarySchema = z.object({
  tabId: z.number().int(),
  title: z.string(),
  url: z.string().url(),
  text: z.string().max(5000),
  capturedAt: z.string().datetime(),
});
export type ActiveTabSummary = z.infer<typeof ActiveTabSummarySchema>;

export const UiTaskSchema = z.object({
  taskId: z.string().uuid(),
  goal: z.string(),
  status: z.enum(["draft", "running", "paused", "completed", "failed", "cancelled"]),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type UiTask = z.infer<typeof UiTaskSchema>;

export const ContentActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("PING") }).strict(),
  z.object({
    type: z.literal("OBSERVE_DOM"),
    taskId: z.string().uuid().optional(),
    tabId: z.number().int().nonnegative().optional(),
    mode: z.enum(["compact", "interactive", "full_limited"]).optional(),
  }).strict(),
  z.object({
    type: z.literal("WAIT_FOR_STATE"),
    condition: z.enum(["element_present", "element_gone", "url_changed", "dom_quiescent"]),
    observationId: z.string().uuid().optional(),
    elementId: z.string().regex(/^el_[1-9]\d*$/).optional(),
    fromUrl: z.string().url().optional(),
    timeoutMs: z.number().int().min(500).max(10000),
  }).strict(),
  z.object({ type: z.literal("EXECUTE_TOOL"), payload: ToolCallEnvelopeSchema }).strict(),
]);
export type ContentAction = z.infer<typeof ContentActionSchema>;

export const ContentActionResponseSchema = z.discriminatedUnion("success", [
  z.object({ success: z.literal(true), payload: z.record(z.unknown()) }).strict(),
  z.object({ success: z.literal(false), error: z.string().min(1) }).strict(),
]);
export type ContentActionResponse = z.infer<typeof ContentActionResponseSchema>;

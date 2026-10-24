import { z } from "zod";

export const ToolCallEnvelopeSchema = z.object({
  protocolVersion: z.literal(1),
  taskId: z.string().uuid(),
  callId: z.string().uuid(),
  tool: z.enum([
    "get_current_tab", "observe_page", "click_element", "type_text", "press_key", "select_option",
    "scroll_page", "navigate", "go_back", "go_forward", "open_tab", "read_page_text",
    "wait_for_state", "capture_screenshot", "request_user_input", "request_approval", "finish_task",
  ]),
  arguments: z.record(z.unknown()),
  reason: z.string().min(1).max(500),
  expectedOutcome: z.string().min(1).max(500),
});
export type ToolCallEnvelope = z.infer<typeof ToolCallEnvelopeSchema>;

export const ErrorClassSchema = z.enum([
  "STALE_ELEMENT", "ELEMENT_NOT_FOUND", "ELEMENT_NOT_INTERACTABLE", "TIMEOUT",
  "NAVIGATION_FAILED", "POLICY_VIOLATION", "UNKNOWN",
]);
export type ErrorClass = z.infer<typeof ErrorClassSchema>;

export const ToolResultSchema = z.object({
  callId: z.string().uuid(),
  taskId: z.string().uuid(),
  status: z.enum(["success", "failed", "blocked_by_policy"]),
  durationMs: z.number().int().nonnegative(),
  errorClass: ErrorClassSchema.nullable(),
  errorMessage: z.string().nullable(),
  beforeObsRef: z.string().uuid().nullable(),
  afterObsRef: z.string().uuid().nullable(),
  summary: z.string(),
  stateDelta: z.object({
    urlChanged: z.boolean(),
    domMutated: z.boolean(),
    newUrl: z.string().url().optional(),
    valuesChanged: z.record(z.string()).optional(),
  }).optional(),
});
export type ToolResult = z.infer<typeof ToolResultSchema>;

import { z } from "zod";
import { BoundingBoxSchema, PageObservationSchema } from "../perception/types.ts";

const Empty = z.object({}).strict();
const elementRef = { observationId: z.string().uuid(), elementId: z.string().regex(/^el_[1-9]\d*$/) };
const safeWebUrl = z.string().url().refine((value) => {
  try { const url = new URL(value); return url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)); }
  catch { return false; }
}, "Only HTTPS and localhost HTTP URLs are allowed");

export const ToolSchemas = {
  get_current_tab: { input: Empty, output: z.object({ id: z.number().int().nonnegative(), url: z.string().url(), title: z.string(), status: z.string(), windowId: z.number().int() }).strict() },
  observe_page: { input: z.object({ mode: z.enum(["compact", "interactive", "full_limited"]).default("interactive") }).strict(), output: PageObservationSchema },
  click_element: { input: z.object(elementRef).strict(), output: z.object({ clicked: z.literal(true), bounds: BoundingBoxSchema }).strict() },
  type_text: { input: z.object({ ...elementRef, text: z.string().max(2000), clearBefore: z.boolean().default(false) }).strict(), output: z.object({ typedLength: z.number().int().nonnegative() }).strict() },
  press_key: { input: z.object({ key: z.enum(["Enter", "Tab", "Escape", "Backspace", "Delete", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "PageUp", "PageDown", "Home", "End", "Space"]), modifiers: z.array(z.enum(["Control", "Alt", "Shift", "Meta"])).max(2).default([]) }).strict(), output: z.object({ dispatched: z.literal(true) }).strict() },
  select_option: { input: z.object({ ...elementRef, value: z.string().max(500) }).strict(), output: z.object({ selectedValue: z.string() }).strict() },
  scroll_page: { input: z.object({ direction: z.enum(["up", "down", "top", "bottom"]), amount: z.number().int().min(50).max(1200).default(500) }).strict(), output: z.object({ currentScrollY: z.number(), hitLimit: z.boolean() }).strict() },
  navigate: { input: z.object({ url: safeWebUrl }).strict(), output: z.object({ navigatedTo: safeWebUrl }).strict() },
  go_back: { input: Empty, output: z.object({ destinationUrl: z.string().url() }).strict() },
  go_forward: { input: Empty, output: z.object({ destinationUrl: z.string().url() }).strict() },
  open_tab: { input: z.object({ url: safeWebUrl, purpose: z.string().trim().min(5).max(150) }).strict(), output: z.object({ tabId: z.number().int().nonnegative(), url: safeWebUrl }).strict() },
  read_page_text: { input: z.object({ maxTokens: z.number().int().min(100).max(4000).default(2000) }).strict(), output: z.object({ text: z.string(), truncated: z.boolean() }).strict() },
  wait_for_state: { input: z.object({
    condition: z.enum(["element_present", "element_gone", "url_changed", "dom_quiescent"]),
    observationId: z.string().uuid().optional(), elementId: z.string().regex(/^el_[1-9]\d*$/).optional(),
    fromUrl: z.string().url().optional(), timeoutMs: z.number().int().min(500).max(10000).default(3000),
  }).strict().superRefine((args, context) => {
    if (["element_present", "element_gone"].includes(args.condition) && (!args.observationId || !args.elementId)) context.addIssue({ code: "custom", message: "Element waits require an observationId and elementId." });
    if (args.condition === "url_changed" && !args.fromUrl) context.addIssue({ code: "custom", message: "URL waits require fromUrl." });
  }), output: z.object({ satisfied: z.boolean(), elapsedMs: z.number().nonnegative() }).strict() },
  capture_screenshot: { input: z.object({ cropRegion: BoundingBoxSchema.optional() }).strict(), output: z.object({ dataUrl: z.string().startsWith("data:image/"), width: z.number().int().positive(), height: z.number().int().positive() }).strict() },
  request_user_input: { input: z.object({ question: z.string().trim().min(3).max(500), options: z.array(z.string().max(150)).max(8).optional() }).strict(), output: z.object({ answer: z.string() }).strict() },
  request_approval: { input: z.object({ summary: z.string().trim().min(5).max(300), target: z.string().trim().min(1).max(500), consequence: z.string().trim().min(5).max(500) }).strict(), output: z.object({ approved: z.boolean(), approvalToken: z.string().uuid().optional() }).strict() },
  finish_task: { input: z.object({ summary: z.string().trim().min(10).max(1000), evidenceRefs: z.array(z.string().min(1).max(200)).min(1).max(50) }).strict(), output: z.object({ completed: z.literal(true) }).strict() },
} as const;

export type ToolName = keyof typeof ToolSchemas;
export type ToolArguments<Name extends ToolName> = z.infer<(typeof ToolSchemas)[Name]["input"]>;
export type RiskTier = 0 | 1 | 2 | 3;

export const ToolRegistry: Record<ToolName, { name: ToolName; riskTier: RiskTier; mutatesPage: boolean; description: string }> = {
  get_current_tab: { name: "get_current_tab", riskTier: 0, mutatesPage: false, description: "Read active tab metadata." },
  observe_page: { name: "observe_page", riskTier: 0, mutatesPage: false, description: "Observe visible page elements with temporary IDs." },
  click_element: { name: "click_element", riskTier: 2, mutatesPage: true, description: "Click one observed element after revalidation and exact-parameter approval." },
  type_text: { name: "type_text", riskTier: 2, mutatesPage: true, description: "Type non-sensitive text into one observed field." },
  press_key: { name: "press_key", riskTier: 1, mutatesPage: true, description: "Send one key from the restricted key set." },
  select_option: { name: "select_option", riskTier: 1, mutatesPage: true, description: "Select a value in an observed native select." },
  scroll_page: { name: "scroll_page", riskTier: 0, mutatesPage: true, description: "Scroll the current page by a bounded distance." },
  navigate: { name: "navigate", riskTier: 1, mutatesPage: true, description: "Navigate within the task's approved origin scope." },
  go_back: { name: "go_back", riskTier: 1, mutatesPage: true, description: "Navigate backward in the active tab." },
  go_forward: { name: "go_forward", riskTier: 1, mutatesPage: true, description: "Navigate forward in the active tab." },
  open_tab: { name: "open_tab", riskTier: 1, mutatesPage: true, description: "Open a task-scoped HTTPS or localhost tab." },
  read_page_text: { name: "read_page_text", riskTier: 0, mutatesPage: false, description: "Read a bounded amount of visible page text." },
  wait_for_state: { name: "wait_for_state", riskTier: 0, mutatesPage: false, description: "Wait for a bounded page state condition." },
  capture_screenshot: { name: "capture_screenshot", riskTier: 1, mutatesPage: false, description: "Capture a screenshot when privacy policy allows it." },
  request_user_input: { name: "request_user_input", riskTier: 0, mutatesPage: false, description: "Ask the user a bounded question." },
  request_approval: { name: "request_approval", riskTier: 0, mutatesPage: false, description: "Request explicit approval for a proposed action." },
  finish_task: { name: "finish_task", riskTier: 0, mutatesPage: false, description: "Finish a task with evidence references." },
};

export function parseToolArguments(tool: string, args: unknown): { name: ToolName; args: unknown } {
  if (!Object.hasOwn(ToolSchemas, tool)) throw new Error(`Unknown tool: ${tool}`);
  const name = tool as ToolName;
  return { name, args: ToolSchemas[name].input.parse(args) };
}

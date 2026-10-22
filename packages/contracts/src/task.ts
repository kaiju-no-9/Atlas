import { z } from "zod";

export const TaskStatusSchema = z.enum([
  "draft", "compiling", "awaiting_plan_approval", "observing", "planning",
  "awaiting_action_approval", "executing", "verifying", "recovering",
  "needs_user_input", "completed", "failed", "cancelled", "paused",
]);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

export const ApprovalPolicySchema = z.enum([
  "consequential_only", "always_ask", "autonomous_read_only",
]);
export type ApprovalPolicy = z.infer<typeof ApprovalPolicySchema>;

export const TaskSpecSchema = z.object({
  taskId: z.string().uuid(),
  schemaVersion: z.literal(1),
  status: TaskStatusSchema,
  goal: z.string().min(1).max(2000),
  category: z.enum(["research_compare", "navigate_organize", "form_fill_preview", "general"]),
  constraints: z.array(z.string()),
  successCriteria: z.array(z.string().min(1)),
  activeTabId: z.number().int().positive(),
  allowedOrigins: z.array(z.string().url()),
  approvalPolicy: ApprovalPolicySchema,
  stepCount: z.number().int().nonnegative().default(0),
  maxSteps: z.number().int().positive().default(30),
  deadline: z.string().datetime(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type TaskSpec = z.infer<typeof TaskSpecSchema>;

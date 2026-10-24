import { z } from "zod";
import { ToolEnvelopeSchema } from "../tools/protocol.ts";

export const AgentStateSchema = z.enum([
  "Draft", "Compiling", "AwaitingPlanApproval", "Observing", "Planning", "AwaitingActionApproval",
  "Executing", "Verifying", "Recovering", "NeedsUserInput", "Paused", "Completed", "Failed", "Cancelled",
]);
export type AgentState = z.infer<typeof AgentStateSchema>;

export const TaskSnapshotSchema = z.object({
  taskId: z.string().uuid(), state: AgentStateSchema,
  stepCount: z.number().int().nonnegative(), activeTabId: z.number().int().nonnegative(),
  lastObservationId: z.string().uuid().optional(), lastObservationFingerprint: z.string().optional(),
  pendingToolEnvelope: ToolEnvelopeSchema.optional(),
  pendingApproval: z.object({ approvalToken: z.string().uuid(), actionKey: z.string().max(5000), approved: z.boolean(), actionSummary: z.string().max(300), consequence: z.string().max(500), tier: z.number().int().min(2).max(3), expiresAt: z.number().int() }).strict().optional(),
  budgetsUsed: z.object({ steps: z.number().int().nonnegative(), tokens: z.number().int().nonnegative(), estimatedCostUsd: z.number().nonnegative().default(0), startTime: z.number().int() }).strict(),
  recoveryAttemptsForCurrentStep: z.number().int().nonnegative(), consecutiveNoProgressSteps: z.number().int().nonnegative(),
  revision: z.number().int().nonnegative(), updatedAt: z.string().datetime(),
  error: z.object({ code: z.string().max(100), message: z.string().max(500) }).strict().optional(),
}).strict();
export type TaskSnapshot = z.infer<typeof TaskSnapshotSchema>;

export const TERMINAL_STATES: ReadonlySet<AgentState> = new Set(["Completed", "Failed", "Cancelled"]);
export const WAITING_STATES: ReadonlySet<AgentState> = new Set(["AwaitingPlanApproval", "AwaitingActionApproval", "NeedsUserInput", "Paused"]);

const TRANSITIONS: Readonly<Record<AgentState, ReadonlySet<AgentState>>> = {
  Draft: new Set(["Compiling", "Cancelled"]),
  Compiling: new Set(["AwaitingPlanApproval", "NeedsUserInput", "Failed", "Cancelled"]),
  AwaitingPlanApproval: new Set(["Observing", "NeedsUserInput", "Failed", "Cancelled"]),
  Observing: new Set(["Planning", "Paused", "Recovering", "Failed", "Cancelled"]),
  Planning: new Set(["Executing", "Verifying", "AwaitingActionApproval", "NeedsUserInput", "Paused", "Recovering", "Failed", "Cancelled"]),
  AwaitingActionApproval: new Set(["Executing", "Planning", "Cancelled"]),
  Executing: new Set(["Verifying", "Recovering", "Paused", "Failed", "Cancelled"]),
  Verifying: new Set(["Planning", "Completed", "Recovering", "Failed", "Cancelled"]),
  Recovering: new Set(["Observing", "NeedsUserInput", "Failed", "Cancelled"]),
  NeedsUserInput: new Set(["Compiling", "Planning", "Observing", "AwaitingPlanApproval", "Failed", "Cancelled"]),
  Paused: new Set(["Observing", "Planning", "Executing", "Cancelled"]),
  Completed: new Set(), Failed: new Set(), Cancelled: new Set(),
};

export function assertTransition(from: AgentState, to: AgentState): void {
  if (!TRANSITIONS[from].has(to)) throw new Error(`Invalid task transition: ${from} -> ${to}`);
}

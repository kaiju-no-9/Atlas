import { z } from "zod";

export const ToolEnvelopeSchema = z.object({
  protocolVersion: z.literal(1), taskId: z.string().uuid(), callId: z.string().uuid(),
  tool: z.string().min(1).max(80), arguments: z.record(z.unknown()), reason: z.string().trim().min(5).max(300),
  expectedOutcome: z.string().trim().min(5).max(300),
}).strict();
export type ToolEnvelope = z.infer<typeof ToolEnvelopeSchema>;

export const ToolResultEnvelopeSchema = z.object({
  callId: z.string().uuid(), taskId: z.string().uuid(), tool: z.string(),
  status: z.enum(["success", "error", "rejected_policy", "revalidation_failed"]),
  data: z.unknown().optional(), error: z.object({ code: z.string(), message: z.string(), retryable: z.boolean() }).strict().optional(),
  beforeObservationId: z.string().min(1), afterObservationId: z.string().uuid().optional(),
  durationMs: z.number().nonnegative(), executedAt: z.string().datetime(),
}).strict();
export type ToolResultEnvelope = z.infer<typeof ToolResultEnvelopeSchema>;

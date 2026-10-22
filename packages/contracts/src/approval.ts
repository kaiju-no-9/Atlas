import { z } from "zod";

export const RiskTierSchema = z.enum(["tier1_safe", "tier2_consequential"]);
export type RiskTier = z.infer<typeof RiskTierSchema>;

export const ApprovalRequestSchema = z.object({
  requestId: z.string().uuid(), taskId: z.string().uuid(), callId: z.string().uuid(),
  riskTier: RiskTierSchema,
  actionSummary: z.string().min(1), consequenceDescription: z.string().min(1),
  targetOrigin: z.string().url(), tool: z.string(), argumentsPreview: z.record(z.string()),
  formValuesSnapshot: z.record(z.string()).optional(),
  createdAt: z.string().datetime(), expiresAt: z.string().datetime(),
});
export type ApprovalRequest = z.infer<typeof ApprovalRequestSchema>;

export const ApprovalResponseSchema = z.object({
  requestId: z.string().uuid(), taskId: z.string().uuid(),
  decision: z.enum(["approved", "rejected", "modified"]),
  approvalToken: z.string().nullable(), userNote: z.string().optional(),
  timestamp: z.string().datetime(),
});
export type ApprovalResponse = z.infer<typeof ApprovalResponseSchema>;

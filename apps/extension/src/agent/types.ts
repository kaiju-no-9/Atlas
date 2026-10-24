import { z } from "zod";
import { ToolSchemas } from "../tools/registry.ts";

export const TaskCategorySchema = z.enum(["research", "form_filling", "navigation", "comparison", "data_extraction"]);
export const PlannedStepSchema = z.object({
  stepNumber: z.number().int().positive(),
  description: z.string().trim().min(1).max(500),
  expectedTool: z.enum(Object.keys(ToolSchemas) as [keyof typeof ToolSchemas, ...(keyof typeof ToolSchemas)[]]),
  targetDomain: z.string().optional(),
  requiresApproval: z.boolean(),
}).strict();
export const TaskSpecSchema = z.object({
  id: z.string().uuid(),
  createdAt: z.string().datetime(),
  rawUserPrompt: z.string().trim().min(1).max(2000),
  goal: z.string().trim().min(5).max(2000),
  category: TaskCategorySchema,
  constraints: z.array(z.string().trim().min(1).max(300)).max(30),
  forbiddenOutcomes: z.array(z.string().trim().min(1).max(300)).max(30),
  successCriteria: z.array(z.string().trim().min(1).max(300)).min(1).max(20),
  allowedOrigins: z.array(z.string().url()).max(5),
  allowedTools: z.array(z.enum(Object.keys(ToolSchemas) as [keyof typeof ToolSchemas, ...(keyof typeof ToolSchemas)[]])).max(17),
  dataExposure: z.object({ containsPII: z.boolean(), discloseToProvider: z.boolean(), sensitiveFieldTypes: z.array(z.string().max(100)).max(20) }).strict(),
  ambiguities: z.array(z.string().trim().min(1).max(300)).max(20),
  proposedPlan: z.array(PlannedStepSchema).max(30),
  budgets: z.object({
    maxSteps: z.number().int().min(1).max(100), deadlineMs: z.number().int().min(1000).max(3600000),
    maxTokens: z.number().int().min(1).max(200000), maxTabs: z.number().int().min(1).max(5), retryBudgetPerStep: z.number().int().min(0).max(5),
  }).strict(),
}).strict();

export type TaskCategory = z.infer<typeof TaskCategorySchema>;
export type PlannedStep = z.infer<typeof PlannedStepSchema>;
export type TaskSpec = z.infer<typeof TaskSpecSchema>;

import { z } from "zod";
import { TaskSpecSchema, type TaskSpec } from "./types.ts";

const CompileDraftSchema = z.object({
  goal: z.string().trim().min(5).max(2000),
  category: z.enum(["research", "form_filling", "navigation", "comparison", "data_extraction"]),
  constraints: z.array(z.string().trim().min(1).max(300)).max(30).default([]),
  forbiddenOutcomes: z.array(z.string().trim().min(1).max(300)).max(30).default([]),
  successCriteria: z.array(z.string().trim().min(1).max(300)).min(1).max(20),
  ambiguities: z.array(z.string().trim().min(1).max(300)).max(20).default([]),
  proposedPlan: z.array(z.object({
    description: z.string().trim().min(1).max(500), expectedTool: z.string(), targetDomain: z.string().optional(), requiresApproval: z.boolean().default(false),
  }).strict()).max(30).default([]),
  containsPII: z.boolean().default(false), sensitiveFieldTypes: z.array(z.string().max(100)).max(20).default([]),
}).strict();

export interface TaskPlanProvider {
  compilePrompt(prompt: string, activeTabUrl?: string): Promise<unknown>;
  compilePromptWithUsage?(prompt: string, activeTabUrl?: string): Promise<{ draft: unknown; usage?: { promptTokens: number; completionTokens: number; totalTokens: number; estimatedCostUsd?: number } }>;
}

/** Turns provider output into a bounded, locally validated task contract. */
export class TaskCompiler {
  private readonly provider: TaskPlanProvider;
  constructor(provider: TaskPlanProvider) { this.provider = provider; }

  async compile(userPrompt: string, activeTabUrl?: string, taskId: string = crypto.randomUUID()): Promise<TaskSpec> {
    return (await this.compileWithUsage(userPrompt, activeTabUrl, taskId)).spec;
  }

  async compileWithUsage(userPrompt: string, activeTabUrl?: string, taskId: string = crypto.randomUUID()): Promise<{ spec: TaskSpec; usage?: { promptTokens: number; completionTokens: number; totalTokens: number; estimatedCostUsd?: number } }> {
    const prompt = z.string().trim().min(1).max(2000).parse(userPrompt);
    let origin: string | undefined;
    if (activeTabUrl) {
      const url = new URL(activeTabUrl);
      if (!isWebOrigin(url)) throw new Error("Tasks can only start from an HTTP or HTTPS page.");
      origin = url.origin;
    }
    const result = this.provider.compilePromptWithUsage
      ? await this.provider.compilePromptWithUsage(prompt, activeTabUrl)
      : { draft: await this.provider.compilePrompt(prompt, activeTabUrl) };
    const draft = CompileDraftSchema.parse(result.draft);
    const now = new Date().toISOString();
    const allowedTools = [...new Set(["finish_task", ...draft.proposedPlan.map(({ expectedTool }) => expectedTool)])];
    const proposedPlan = draft.proposedPlan.map((step, index) => ({
      stepNumber: index + 1,
      description: step.description,
      expectedTool: step.expectedTool,
      ...(step.targetDomain ? { targetDomain: step.targetDomain } : {}),
      requiresApproval: step.requiresApproval || isConsequential(step.description),
    }));
    const spec = TaskSpecSchema.parse({
      id: z.string().uuid().parse(taskId), createdAt: now, rawUserPrompt: prompt, goal: draft.goal, category: draft.category,
      constraints: draft.constraints,
      forbiddenOutcomes: [...new Set(["Do not make purchases, submit final forms, send messages, or delete data without explicit approval.", ...draft.forbiddenOutcomes])],
      successCriteria: draft.successCriteria,
      // Phase 3 is single-tab; the compiler never lets model output widen this origin boundary.
      allowedOrigins: origin ? [origin] : [],
      allowedTools,
      dataExposure: { containsPII: draft.containsPII, discloseToProvider: false, sensitiveFieldTypes: draft.sensitiveFieldTypes },
      ambiguities: draft.ambiguities, proposedPlan,
      budgets: { maxSteps: 30, deadlineMs: 600000, maxTokens: 50000, maxTabs: 1, retryBudgetPerStep: 2 },
    });
    return { spec, ...(result.usage ? { usage: result.usage } : {}) };
  }
}

function isWebOrigin(url: URL): boolean { return url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)); }
function isConsequential(text: string): boolean { return /\b(submit|send|purchase|buy|pay|checkout|delete|remove|transfer|publish|post)\b/i.test(text); }

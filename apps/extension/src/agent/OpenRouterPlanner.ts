import { z } from "zod";
import type { PageObservation } from "../perception/types.ts";
import { ToolEnvelopeSchema } from "../tools/protocol.ts";
import type { AgentPlanner, AgentProposalWithUsage } from "./controller.ts";
import type { ModelProvider, TokenUsage } from "./provider.ts";
import type { TaskSpec } from "./types.ts";
import { ContextPackager } from "./contextPackager.ts";

const ProposalSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("tool"), tool: z.string().min(1).max(80), arguments: z.record(z.unknown()), reason: z.string().min(5).max(300).optional(), expectedOutcome: z.string().min(5).max(300).optional() }).strict(),
  z.object({ kind: z.literal("clarification"), question: z.string().min(3).max(500) }).strict(),
  z.object({ kind: z.literal("finish"), summary: z.string().min(10).max(1000), evidenceRefs: z.array(z.string().min(1).max(200)).min(1).max(50) }).strict(),
]);

/** Converts the model's one-step JSON response into the controller's strict local contract. */
export class OpenRouterPlanner implements AgentPlanner {
  private readonly provider: ModelProvider;
  private readonly context = new ContextPackager();
  constructor(provider: ModelProvider) { this.provider = provider; }

  async proposeNext(task: TaskSpec, observation: PageObservation): Promise<AgentProposalWithUsage> {
    const packaged = this.context.package(task, observation);
    const response = await this.provider.proposeNext({
      systemPolicy: `${packaged.systemPrompt} Return exactly one JSON object with kind=tool, clarification, or finish. For tool use include a registered tool name, arguments, reason, and expectedOutcome.`,
      taskSpec: task,
      observation,
      promptOverride: packaged.userPrompt,
    });
    if (!response.rawContent) {
      if (response.finish) return { kind: "finish", ...response.finish, ...(response.usage ? { usage: response.usage } : {}) };
      if (response.needInput) return { kind: "clarification", question: response.needInput.question, ...(response.usage ? { usage: response.usage } : {}) };
      throw new Error("PROVIDER_EMPTY_PROPOSAL: OpenRouter did not return a task step.");
    }
    let proposal: z.infer<typeof ProposalSchema>;
    try { proposal = ProposalSchema.parse(JSON.parse(stripFence(response.rawContent))); }
    catch { throw new Error("PROVIDER_INVALID_PROPOSAL: OpenRouter returned a malformed task step."); }
    if (proposal.kind !== "tool") return { ...proposal, ...(response.usage ? { usage: response.usage } : {}) };
    if (proposal.tool === "request_user_input") {
      const question = proposal.arguments.question;
      if (typeof question !== "string" || question.length < 3) throw new Error("PROVIDER_INVALID_PROPOSAL: The clarification question was malformed.");
      return { kind: "clarification", question: question.slice(0, 500), ...(response.usage ? { usage: response.usage } : {}) };
    }
    if (proposal.tool === "finish_task") {
      const args = proposal.arguments;
      const finish = z.object({ summary: z.string().min(10).max(1000), evidenceRefs: z.array(z.string().min(1).max(200)).min(1).max(50) }).safeParse(args);
      if (!finish.success) throw new Error("PROVIDER_INVALID_PROPOSAL: The completion summary or evidence was malformed.");
      return { kind: "finish", ...finish.data, ...(response.usage ? { usage: response.usage } : {}) };
    }
    const envelope = ToolEnvelopeSchema.parse({
      protocolVersion: 1, taskId: task.id, callId: crypto.randomUUID(), tool: proposal.tool,
      arguments: proposal.arguments,
      reason: proposal.reason ?? "Advance the approved task goal",
      expectedOutcome: proposal.expectedOutcome ?? "The expected browser state is observed",
    });
    return { kind: "tool", envelope, ...(response.usage ? { usage: response.usage } : {}) };
  }

  async verifyCompletion(task: TaskSpec, observation: PageObservation, summary: string, evidenceRefs: string[]): Promise<{ complete: boolean; usage?: TokenUsage }> {
    const packaged = this.context.package(task, observation);
    const response = await this.provider.proposeNext({
      systemPolicy: `${packaged.systemPrompt} Determine whether every success criterion is supported by evidence. Return only JSON {\"satisfied\": boolean}.`,
      taskSpec: task, observation,
      promptOverride: `${packaged.userPrompt}\n\nProposed summary: ${summary}\nEvidence references: ${JSON.stringify(evidenceRefs)}\nReturn only {"satisfied":true|false}.`,
    });
    if (!response.rawContent) return { complete: false };
    try {
      const result = z.object({ satisfied: z.boolean() }).strict().parse(JSON.parse(stripFence(response.rawContent)));
      return { complete: result.satisfied, ...(response.usage ? { usage: response.usage } : {}) };
    } catch { return { complete: false, ...(response.usage ? { usage: response.usage } : {}) }; }
  }
}

function stripFence(value: string): string { return value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""); }

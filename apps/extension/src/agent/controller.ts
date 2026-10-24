import type { PageObservation } from "../perception/types.ts";
import type { ToolValidationPipeline } from "../tools/pipeline.ts";
import { ToolEnvelopeSchema, type ToolEnvelope } from "../tools/protocol.ts";
import { actionKey } from "../tools/pipeline.ts";
import { parseToolArguments } from "../tools/registry.ts";
import { PolicyEngine } from "../policy/engine.ts";
import type { TaskCompiler } from "./compiler.ts";
import { TaskRepository } from "./TaskRepository.ts";
import { assertTransition, TERMINAL_STATES, WAITING_STATES, type AgentState, type TaskSnapshot } from "./states.ts";
import type { TaskSpec } from "./types.ts";
import { OutcomeVerifier } from "./verifier.ts";
import type { TokenUsage } from "./provider.ts";

export type AgentProposal =
  | { kind: "tool"; envelope: unknown }
  | { kind: "clarification"; question: string }
  | { kind: "finish"; summary: string; evidenceRefs: string[] };
export type AgentProposalWithUsage = AgentProposal & { usage?: TokenUsage };
export interface AgentPlanner {
  proposeNext(task: TaskSpec, observation: PageObservation): Promise<AgentProposalWithUsage>;
  verifyCompletion?(task: TaskSpec, observation: PageObservation, summary: string, evidenceRefs: string[]): Promise<boolean | { complete: boolean; usage?: TokenUsage }>;
}
export interface AgentObserver { captureSnapshot(taskId: string, tabId: number, mode: "interactive"): Promise<PageObservation> }

/** Single-tick MV3 controller. Each state change is checkpointed before returning to Chrome. */
export class TaskController {
  private readonly repo: TaskRepository;
  private readonly compiler: TaskCompiler;
  private readonly observer: AgentObserver;
  private readonly pipeline: ToolValidationPipeline;
  private readonly policy: PolicyEngine;
  private readonly planner: AgentPlanner;
  private readonly verifier: OutcomeVerifier;

  constructor(
    repo: TaskRepository,
    compiler: TaskCompiler,
    observer: AgentObserver,
    pipeline: ToolValidationPipeline,
    policy: PolicyEngine,
    planner: AgentPlanner,
  ) {
    this.repo = repo;
    this.compiler = compiler;
    this.observer = observer;
    this.pipeline = pipeline;
    this.policy = policy;
    this.planner = planner;
    this.verifier = new OutcomeVerifier();
  }

  async compileTask(taskId: string, goal: string, tabId: number): Promise<TaskSnapshot> {
    const tab = await chrome.tabs.get(tabId);
    if (!tab.url) throw new Error("The active tab has no inspectable URL.");
    const compiled = await this.compiler.compileWithUsage(goal, tab.url, taskId);
    const spec = compiled.spec;
    let snapshot = await this.repo.create(taskId, tabId, spec);
    if (compiled.usage) {
      snapshot.budgetsUsed.tokens = compiled.usage.totalTokens;
      snapshot.budgetsUsed.estimatedCostUsd = compiled.usage.estimatedCostUsd ?? 0;
      snapshot = await this.repo.saveTaskSnapshot(snapshot);
      if (snapshot.budgetsUsed.tokens > spec.budgets.maxTokens) return this.fail(snapshot, "TOKEN_BUDGET_EXCEEDED", "Task planning exceeded the model token budget.");
    }
    if (spec.ambiguities.length) return this.transition(snapshot, "NeedsUserInput");
    return snapshot;
  }

  async approvePlan(taskId: string, approved: boolean): Promise<TaskSnapshot> {
    const snapshot = await this.requiredSnapshot(taskId);
    if (snapshot.state !== "AwaitingPlanApproval") throw new Error("This task is not waiting for plan approval.");
    return this.transition(snapshot, approved ? "Observing" : "Cancelled");
  }

  async approveAction(taskId: string, token: string, approved: boolean): Promise<TaskSnapshot> {
    const snapshot = await this.requiredSnapshot(taskId);
    const approval = snapshot.pendingApproval;
    if (snapshot.state !== "AwaitingActionApproval" || !approval || approval.approvalToken !== token || approval.expiresAt < Date.now()) {
      throw new Error("The action approval is missing, expired, or belongs to another action.");
    }
    if (!approved) {
      snapshot.pendingApproval = undefined;
      snapshot.pendingToolEnvelope = undefined;
      return this.transition(snapshot, "Planning");
    }
    approval.approved = true;
    await this.repo.saveTaskSnapshot(snapshot);
    return this.transition(snapshot, "Executing");
  }

  async provideClarification(taskId: string, answer: string): Promise<TaskSnapshot> {
    const cleaned = answer.trim().slice(0, 1000);
    if (!cleaned) throw new Error("Enter a clarification before continuing.");
    const snapshot = await this.requiredSnapshot(taskId);
    if (snapshot.state !== "NeedsUserInput") throw new Error("This task is not waiting for clarification.");
    const spec = await this.repo.getTaskSpec(taskId);
    if (spec.ambiguities.length > 0) {
      const compiling = await this.transition(snapshot, "Compiling");
      try {
        const tab = await chrome.tabs.get(snapshot.activeTabId);
        const compiled = await this.compiler.compileWithUsage(`${spec.rawUserPrompt}\nUser clarification: ${cleaned}`, tab.url, taskId);
        await this.repo.saveTaskSpec(compiled.spec);
        if (compiled.usage) {
          compiling.budgetsUsed.tokens += compiled.usage.totalTokens;
          compiling.budgetsUsed.estimatedCostUsd += compiled.usage.estimatedCostUsd ?? 0;
          await this.repo.saveTaskSnapshot(compiling);
          if (compiling.budgetsUsed.tokens > compiled.spec.budgets.maxTokens) {
            return this.fail(compiling, "TOKEN_BUDGET_EXCEEDED", "The model token budget was exceeded while processing clarification.");
          }
        }
        if (compiled.spec.ambiguities.length > 0) {
          compiling.error = { code: "NEEDS_USER_INPUT", message: compiled.spec.ambiguities.join("; ").slice(0, 500) };
          return this.transition(compiling, "NeedsUserInput");
        }
        compiling.error = undefined;
        return this.transition(compiling, "AwaitingPlanApproval");
      } catch (cause) {
        compiling.error = { code: "TASK_RECOMPILE_FAILED", message: cause instanceof Error ? cause.message.slice(0, 500) : "Task clarification failed." };
        return this.transition(compiling, "Failed");
      }
    }
    spec.constraints = [...spec.constraints, `User clarification: ${cleaned}`].slice(-30);
    await this.repo.saveTaskSpec(spec);
    snapshot.error = undefined;
    return this.transition(snapshot, "Planning");
  }

  async cancel(taskId: string): Promise<TaskSnapshot> {
    const snapshot = await this.requiredSnapshot(taskId);
    if (TERMINAL_STATES.has(snapshot.state)) return snapshot;
    return this.transition(snapshot, "Cancelled");
  }

  async pause(taskId: string): Promise<TaskSnapshot> {
    const snapshot = await this.requiredSnapshot(taskId);
    if (!["Observing", "Planning", "Executing"].includes(snapshot.state)) throw new Error("This task cannot be paused in its current state.");
    return this.transition(snapshot, "Paused");
  }

  async resume(taskId: string): Promise<TaskSnapshot> {
    const snapshot = await this.requiredSnapshot(taskId);
    if (snapshot.state !== "Paused") throw new Error("This task is not paused.");
    return this.transition(snapshot, snapshot.lastObservationId ? "Planning" : "Observing");
  }

  async tick(taskId: string): Promise<TaskSnapshot> {
    const snapshot = await this.requiredSnapshot(taskId);
    if (TERMINAL_STATES.has(snapshot.state) || WAITING_STATES.has(snapshot.state)) return snapshot;
    const spec = await this.repo.getTaskSpec(taskId);
    const now = Date.now();
    if (snapshot.stepCount >= spec.budgets.maxSteps) return this.fail(snapshot, "STEP_BUDGET_EXCEEDED", "Maximum task steps reached.");
    if (now - snapshot.budgetsUsed.startTime >= spec.budgets.deadlineMs) return this.fail(snapshot, "DEADLINE_EXCEEDED", "Task deadline expired.");

    try {
      switch (snapshot.state) {
        case "Observing": {
          const observation = await this.observer.captureSnapshot(taskId, snapshot.activeTabId, "interactive");
          await this.repo.saveObservation(observation);
          snapshot.lastObservationId = observation.observationId;
          snapshot.lastObservationFingerprint = observation.fingerprint;
          return this.transition(snapshot, "Planning");
        }
        case "Planning":
          return this.plan(snapshot, spec);
        case "Executing":
          return this.execute(snapshot, spec);
        case "Verifying":
          return this.verify(snapshot, spec);
        case "Recovering":
          if (snapshot.error?.code !== "NO_PROGRESS") {
            if (snapshot.recoveryAttemptsForCurrentStep >= spec.budgets.retryBudgetPerStep) return this.fail(snapshot, "RETRY_BUDGET_EXHAUSTED", "Recovery retries for this step were exhausted.");
            snapshot.recoveryAttemptsForCurrentStep += 1;
          }
          snapshot.error = undefined;
          return this.transition(snapshot, "Observing");
        default:
          return snapshot;
      }
    } catch (cause) {
      snapshot.error = { code: "AGENT_TICK_FAILED", message: cause instanceof Error ? cause.message.slice(0, 500) : "Agent step failed." };
      return this.transition(snapshot, "Recovering");
    }
  }

  private async plan(snapshot: TaskSnapshot, spec: TaskSpec): Promise<TaskSnapshot> {
    const observation = await this.observation(snapshot);
    const proposal = await this.planner.proposeNext(spec, observation);
    if (proposal.usage) {
      snapshot.budgetsUsed.tokens += proposal.usage.totalTokens;
      snapshot.budgetsUsed.estimatedCostUsd += proposal.usage.estimatedCostUsd ?? 0;
      snapshot = await this.repo.saveTaskSnapshot(snapshot);
      if (snapshot.budgetsUsed.tokens > spec.budgets.maxTokens) return this.fail(snapshot, "TOKEN_BUDGET_EXCEEDED", "The model token budget was exceeded; no browser action was dispatched.");
    }
    if (proposal.kind === "clarification") {
      snapshot.error = { code: "NEEDS_USER_INPUT", message: proposal.question.slice(0, 500) };
      return this.transition(snapshot, "NeedsUserInput");
    }
    if (proposal.kind === "finish") {
      snapshot.pendingToolEnvelope = ToolEnvelopeSchema.parse({
        protocolVersion: 1, taskId: snapshot.taskId, callId: crypto.randomUUID(), tool: "finish_task",
        arguments: { summary: proposal.summary, evidenceRefs: proposal.evidenceRefs }, reason: "Evaluate task completion",
        expectedOutcome: "All task success criteria are verified",
      });
      return this.transition(snapshot, "Verifying");
    }
    const envelope = ToolEnvelopeSchema.parse(proposal.envelope);
    if (envelope.taskId !== snapshot.taskId || !spec.allowedTools.includes(envelope.tool as never)) return this.fail(snapshot, "TOOL_NOT_ALLOWED", "The proposed tool is outside the compiled task plan.");
    const tab = await chrome.tabs.get(snapshot.activeTabId);
    const risk = this.policy.classifyActionRisk(envelope, tab.url ?? "", new Set(spec.allowedOrigins));
    snapshot.pendingToolEnvelope = envelope;
    if (risk.tier >= 2) {
      const parsedAction = parseToolArguments(envelope.tool, envelope.arguments);
      snapshot.pendingApproval = { approvalToken: crypto.randomUUID(), actionKey: actionKey(parsedAction.name, parsedAction.args), approved: false,
        actionSummary: risk.summary, consequence: risk.consequence, tier: risk.tier, expiresAt: Date.now() + 180000 };
      return this.transition(snapshot, "AwaitingActionApproval");
    }
    return this.transition(snapshot, "Executing");
  }

  private async execute(snapshot: TaskSnapshot, spec: TaskSpec): Promise<TaskSnapshot> {
    const envelope = snapshot.pendingToolEnvelope;
    if (!envelope || !snapshot.lastObservationId) return this.fail(snapshot, "MISSING_STEP_STATE", "The action or observation checkpoint is missing.");
    const tab = await chrome.tabs.get(snapshot.activeTabId);
    const observation = await this.observation(snapshot);
    const approvedActions = snapshot.pendingApproval?.approved ? new Set([snapshot.pendingApproval.actionKey]) : new Set<string>();
    const result = await this.pipeline.execute(envelope, {
      taskId: snapshot.taskId, tabId: snapshot.activeTabId, currentUrl: tab.url ?? "", taskStatus: "running", cancelRequested: false,
      allowedTools: new Set(spec.allowedTools), allowedOrigins: new Set(spec.allowedOrigins), activeObservationId: snapshot.lastObservationId,
      activeObservation: observation, approvedActions,
    });
    await this.repo.saveToolResult(result);
    snapshot.stepCount += 1;
    snapshot.budgetsUsed.steps += 1;
    snapshot.pendingApproval = undefined;
    if (result.status !== "success") {
      snapshot.error = { code: result.error?.code ?? result.status.toUpperCase(), message: result.error?.message ?? "Browser tool did not succeed." };
      return this.transition(snapshot, "Recovering");
    }
    return this.transition(snapshot, "Verifying");
  }

  private async verify(snapshot: TaskSnapshot, spec: TaskSpec): Promise<TaskSnapshot> {
    const envelope = snapshot.pendingToolEnvelope;
    if (!envelope) return this.fail(snapshot, "MISSING_STEP_STATE", "No pending action can be verified.");
    const before = await this.observation(snapshot);
    const observation = await this.observer.captureSnapshot(snapshot.taskId, snapshot.activeTabId, "interactive");
    await this.repo.saveObservation(observation);
    if (envelope.tool === "finish_task") {
      const args = envelope.arguments as { summary?: string; evidenceRefs?: string[] };
      const completionResult = await this.planner.verifyCompletion?.(spec, observation, args.summary ?? "", args.evidenceRefs ?? []) ?? false;
      if (typeof completionResult !== "boolean" && completionResult.usage) {
        snapshot.budgetsUsed.tokens += completionResult.usage.totalTokens;
        snapshot.budgetsUsed.estimatedCostUsd += completionResult.usage.estimatedCostUsd ?? 0;
        snapshot = await this.repo.saveTaskSnapshot(snapshot);
        if (snapshot.budgetsUsed.tokens > spec.budgets.maxTokens) return this.fail(snapshot, "TOKEN_BUDGET_EXCEEDED", "Task verification exceeded the model token budget.");
      }
      const complete = typeof completionResult === "boolean" ? completionResult : completionResult.complete;
      if (complete) return this.transition(snapshot, "Completed");
      return this.fail(snapshot, "SUCCESS_CRITERIA_UNVERIFIED", "The task completion criteria could not be verified.");
    }
    const verification = this.verifier.verifyStep(envelope, before, observation);
    snapshot.lastObservationId = observation.observationId;
    snapshot.lastObservationFingerprint = observation.fingerprint;
    snapshot.pendingToolEnvelope = undefined;
    if (!verification.progressMade) {
      snapshot.consecutiveNoProgressSteps += 1;
      if (snapshot.consecutiveNoProgressSteps >= 3) return this.fail(snapshot, "STUCK_LOOP_DETECTED", `Three consecutive actions made no verified progress. Last check: ${verification.details}`);
      snapshot.error = { code: "NO_PROGRESS", message: verification.details };
      return this.transition(snapshot, "Recovering");
    }
    snapshot.consecutiveNoProgressSteps = 0;
    snapshot.recoveryAttemptsForCurrentStep = 0;
    return this.transition(snapshot, "Planning");
  }

  private async observation(snapshot: TaskSnapshot): Promise<PageObservation> {
    if (!snapshot.lastObservationId) throw new Error("No observation has been recorded for this task.");
    const observation = await this.repo.getObservation(snapshot.taskId, snapshot.lastObservationId);
    if (!observation) throw new Error("The last page observation could not be restored.");
    return observation;
  }

  private async requiredSnapshot(taskId: string): Promise<TaskSnapshot> {
    const snapshot = await this.repo.getTaskSnapshot(taskId);
    if (!snapshot) throw new Error(`Task snapshot ${taskId} was not found.`);
    return snapshot;
  }

  private async fail(snapshot: TaskSnapshot, code: string, message: string): Promise<TaskSnapshot> {
    snapshot.error = { code, message };
    return this.transition(snapshot, "Failed");
  }

  private async transition(snapshot: TaskSnapshot, state: AgentState): Promise<TaskSnapshot> {
    assertTransition(snapshot.state, state);
    snapshot.state = state;
    return this.repo.saveTaskSnapshot(snapshot);
  }
}

import { z } from "zod";
import { ActionQueue } from "../browser/actionQueue.ts";
import { ToolRegistry, ToolSchemas, type ToolName } from "./registry.ts";
import { ToolEnvelopeSchema, type ToolEnvelope, type ToolResultEnvelope } from "./protocol.ts";
import { PageObservationSchema } from "../perception/types.ts";

export interface PipelineContext {
  taskId: string; tabId: number; currentUrl: string; taskStatus: "running" | "paused" | "cancelled" | "completed" | "failed";
  cancelRequested: boolean; allowedTools: ReadonlySet<string>; allowedOrigins: ReadonlySet<string>;
  activeObservationId: string; activeObservation?: unknown; approvedActions: ReadonlySet<string>;
}
export type ToolAdapter = (tabId: number, tool: ToolName, args: unknown, envelope: ToolEnvelope) => Promise<unknown>;
export type OutcomeVerifier = (tool: ToolName, args: unknown, output: unknown, context: PipelineContext) => Promise<{ verified: boolean; observationId?: string }>;

/** Schema, task, capability, origin, freshness, approval, queue, output and outcome checks. */
export class ToolValidationPipeline {
  private readonly queue: ActionQueue;
  private readonly dispatch: ToolAdapter;
  private readonly verify?: OutcomeVerifier;
  constructor(queue: ActionQueue, dispatch: ToolAdapter, verify?: OutcomeVerifier) { this.queue = queue; this.dispatch = dispatch; this.verify = verify; }

  async execute(raw: unknown, ctx: PipelineContext): Promise<ToolResultEnvelope> {
    const start = performance.now();
    const parsed = ToolEnvelopeSchema.safeParse(raw);
    if (!parsed.success) return this.error("INVALID_ENVELOPE", "Malformed tool envelope.", raw, start);
    const env = parsed.data;
    const contextParsed = PipelineContextSchema.safeParse(ctx);
    if (!contextParsed.success) return this.error("INVALID_CONTEXT", "Trusted task context is malformed.", env, start);
    ctx = contextParsed.data;
    if (env.taskId !== ctx.taskId) return this.error("TASK_MISMATCH", "The tool call belongs to a different task.", env, start);
    if (!Object.hasOwn(ToolSchemas, env.tool)) return this.error("UNKNOWN_TOOL", "The requested tool is not registered.", env, start);
    const tool = env.tool as ToolName;
    const argsParsed = ToolSchemas[tool].input.safeParse(env.arguments);
    if (!argsParsed.success) return this.error("INVALID_ARGUMENTS", "Tool arguments did not match its schema.", env, start);
    const args = argsParsed.data;
    if (ctx.taskStatus !== "running" || ctx.cancelRequested) return this.error("TASK_NOT_RUNNING", "The task is paused, cancelled, or already terminal.", env, start);
    if (!ctx.allowedTools.has(tool)) return this.error("TOOL_NOT_PERMITTED", "This tool is not allowed for the task.", env, start, "rejected_policy");
    if (!this.isInScope(ctx.currentUrl, ctx.allowedOrigins)) return this.error("ORIGIN_OUT_OF_SCOPE", "The active page is outside the task's allowed origins.", env, start, "rejected_policy");
    if (tool === "click_element" || tool === "type_text" || tool === "select_option") {
      if ("observationId" in args && args.observationId !== ctx.activeObservationId) return this.error("STALE_OBSERVATION", "Observe the page again before using this element ID.", env, start, "revalidation_failed", true);
    }
    const targetUrl = "url" in args ? args.url : undefined;
    if (typeof targetUrl === "string" && !this.isInScope(targetUrl, ctx.allowedOrigins)) return this.error("ORIGIN_OUT_OF_SCOPE", "The destination is outside the task's allowed origins.", env, start, "rejected_policy");
    const definition = ToolRegistry[tool];
    const approvalKey = actionKey(tool, args);
    if (definition.riskTier >= 2 && !ctx.approvedActions.has(approvalKey)) return this.error("APPROVAL_REQUIRED", "This action requires user approval for these exact parameters.", env, start, "rejected_policy");
    try {
      const output = definition.mutatesPage
        ? await this.queue.enqueue(ctx.tabId, () => this.dispatch(ctx.tabId, tool, args, env))
        : await this.dispatch(ctx.tabId, tool, args, env);
      const outputParsed = ToolSchemas[tool].output.safeParse(output);
      if (!outputParsed.success) return this.error("INVALID_TOOL_OUTPUT", "The browser adapter returned an invalid result.", env, start);
      // Never report a page mutation as successful without a post-action check.
      const verification = this.verify
        ? await this.verify(tool, args, outputParsed.data, ctx)
        : { verified: !definition.mutatesPage };
      if (!verification.verified) return this.error("OUTCOME_UNVERIFIED", "The expected page change could not be confirmed.", env, start, "error", true);
      return {
        callId: env.callId, taskId: env.taskId, tool, status: "success", data: sanitize(outputParsed.data),
        beforeObservationId: ctx.activeObservationId, ...(verification.observationId ? { afterObservationId: verification.observationId } : {}),
        durationMs: performance.now() - start, executedAt: new Date().toISOString(),
      };
    } catch (cause) {
      const code = typeof cause === "object" && cause !== null && "code" in cause && typeof cause.code === "string" ? cause.code : "EXECUTION_FAILURE";
      const retryable = typeof cause === "object" && cause !== null && "retryable" in cause && cause.retryable === true;
      return this.error(code, cause instanceof Error ? cause.message.slice(0, 300) : "Browser tool failed.", env, start, "error", retryable);
    }
  }

  private isInScope(rawUrl: string, allowedOrigins: ReadonlySet<string>): boolean {
    try { return allowedOrigins.has(new URL(rawUrl).origin); } catch { return false; }
  }

  private error(code: string, message: string, envRaw: unknown, start: number, status: ToolResultEnvelope["status"] = "error", retryable = false): ToolResultEnvelope {
    const env = ToolEnvelopeSchema.safeParse(envRaw);
    return {
      callId: env.success ? env.data.callId : crypto.randomUUID(), taskId: env.success ? env.data.taskId : crypto.randomUUID(),
      tool: env.success ? env.data.tool : "unknown", status, error: { code, message, retryable },
      beforeObservationId: "none", durationMs: Math.max(0, performance.now() - start), executedAt: new Date().toISOString(),
    };
  }
}

export function actionKey(tool: ToolName, args: unknown): string { return `${tool}:${JSON.stringify(args)}`; }
function sanitize(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value, (key, item: unknown) => /^(api.?key|authorization|password|secret|token)$/i.test(key) ? undefined : item)) as unknown;
}

export const PipelineContextSchema = z.object({
  taskId: z.string().uuid(), tabId: z.number().int().nonnegative(), currentUrl: z.string().url(), taskStatus: z.enum(["running", "paused", "cancelled", "completed", "failed"]),
  cancelRequested: z.boolean(), allowedTools: z.set(z.string()), allowedOrigins: z.set(z.string()), activeObservationId: z.string().uuid(),
  activeObservation: PageObservationSchema.optional(), approvedActions: z.set(z.string()),
});
export type { ToolEnvelope };

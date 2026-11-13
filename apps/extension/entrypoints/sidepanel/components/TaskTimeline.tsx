import type { ActiveTabSummary, UiTask } from "@atlas/contracts";
import type { TaskSpec } from "../../../src/agent/types";
import type { TaskSnapshot } from "../../../src/agent/states";
import { useEffect, useState } from "react";

type Props = { task: UiTask | null; activeTab: ActiveTabSummary | null; agentTask?: { snapshot: TaskSnapshot; spec: TaskSpec } | null; onApproveAction?: (approvalToken: string, approved: boolean) => void; onEditAction?: (approvalToken: string, args: Record<string, unknown>) => void; onClarification?: (answer: string) => void };

const statusLabel: Record<UiTask["status"], string> = {
  draft: "Ready to run",
  running: "Running",
  paused: "Paused",
  completed: "Completed",
  failed: "Needs attention",
  cancelled: "Stopped",
};

export function TaskTimeline({ task, activeTab, agentTask, onApproveAction, onEditAction, onClarification }: Props) {
  const [clarification, setClarification] = useState("");
  const [approvalSeconds, setApprovalSeconds] = useState(0);
  const [editingAction, setEditingAction] = useState(false);
  const [actionArgsDraft, setActionArgsDraft] = useState("");
  const [actionArgsError, setActionArgsError] = useState("");
  const pendingApproval = agentTask?.snapshot.pendingApproval;
  useEffect(() => {
    if (!pendingApproval) { setApprovalSeconds(0); return; }
    const update = () => setApprovalSeconds(Math.max(0, Math.ceil((pendingApproval.expiresAt - Date.now()) / 1000)));
    update();
    const timer = window.setInterval(update, 250);
    return () => window.clearInterval(timer);
  }, [pendingApproval?.approvalToken, pendingApproval?.expiresAt]);
  useEffect(() => {
    if (!pendingApproval) return;
    const timeout = window.setTimeout(() => onApproveAction?.(pendingApproval.approvalToken, false), Math.max(0, pendingApproval.expiresAt - Date.now()));
    return () => window.clearTimeout(timeout);
  }, [pendingApproval?.approvalToken, pendingApproval?.expiresAt, onApproveAction]);
  if (!task) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center px-7 text-center">
        <div className="mb-5 grid h-14 w-14 place-items-center rounded-2xl bg-blue-50 text-xl text-accent" aria-hidden="true">✦</div>
        <h2 className="text-base font-semibold text-ink">A clearer way to get things done</h2>
        <p className="mt-2 max-w-xs text-sm leading-6 text-muted">Atlas can research across pages and prepare forms. You stay in control of every consequential action.</p>
        {activeTab && <p className="mt-5 max-w-xs truncate rounded-full border border-line bg-white px-3 py-1.5 text-xs text-muted" title={activeTab.title}>On this page: {activeTab.title || activeTab.url}</p>}
      </div>
    );
  }

  return (
    <section className="flex-1 overflow-y-auto px-4 py-5" aria-live="polite">
      <article className="rounded-2xl border border-line bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <span className="eyebrow">Current task</span>
          <span className={`status status-${task.status}`}>{statusLabel[task.status]}</span>
        </div>
        <h2 className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-ink">{task.goal}</h2>
        <p className="mt-4 border-t border-line pt-3 text-xs leading-5 text-muted">{agentTask ? `Agent state: ${agentTask.snapshot.state}. Model usage: ${agentTask.snapshot.budgetsUsed.tokens} tokens; estimated cost $${agentTask.snapshot.budgetsUsed.estimatedCostUsd.toFixed(4)}.` : "Your task is saved locally. Configure an OpenRouter key in Settings to prepare its execution plan."}</p>
      </article>
      {agentTask?.snapshot.state === "AwaitingPlanApproval" && <article className="mt-4 rounded-2xl border border-line bg-white p-4">
        <span className="eyebrow">Proposed plan</span>
        <p className="mt-2 text-sm font-medium text-ink">{agentTask.spec.goal}</p>
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-xs leading-5 text-muted">{agentTask.spec.proposedPlan.map((step) => <li key={step.stepNumber}>{step.description}{step.requiresApproval ? " · approval required" : ""}</li>)}</ol>
        <p className="mt-3 text-xs text-muted">Allowed site: {agentTask.spec.allowedOrigins.join(", ") || "active page only"} · {agentTask.spec.budgets.maxSteps} step limit</p>
      </article>}
      {agentTask?.snapshot.state === "AwaitingActionApproval" && pendingApproval && <article className={`mt-4 rounded-2xl border p-4 ${pendingApproval.tier === 3 ? "border-red-300 bg-red-50" : "border-amber-200 bg-amber-50"}`}>
        <div className="flex items-center justify-between gap-2"><span className="eyebrow">Review this action · Tier {pendingApproval.tier}</span><span className="text-xs font-semibold tabular-nums" role="timer">Expires in {approvalSeconds}s</span></div>
        <p className="mt-2 text-sm font-medium text-ink">{pendingApproval.actionSummary}</p>
        <p className="mt-1 text-xs leading-5 text-muted">{pendingApproval.consequence}</p>
        {agentTask.snapshot.pendingToolEnvelope && <><p className="mt-2 text-[11px] text-muted">Target: {agentTask.spec.allowedOrigins[0] ?? "current page"}{typeof agentTask.snapshot.pendingToolEnvelope.arguments.elementId === "string" ? ` · ${agentTask.snapshot.pendingToolEnvelope.arguments.elementId}` : ""} · {agentTask.snapshot.pendingToolEnvelope.tool}</p>{editingAction ? <form className="mt-3" onSubmit={(event) => { event.preventDefault(); try { const args: unknown = JSON.parse(actionArgsDraft); if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error("Arguments must be a JSON object."); onEditAction?.(pendingApproval.approvalToken, args as Record<string, unknown>); setEditingAction(false); setActionArgsError(""); } catch (cause) { setActionArgsError(cause instanceof Error ? cause.message : "Enter valid JSON arguments."); } }}><label className="text-xs font-medium" htmlFor="action-args">Edit action arguments</label><textarea id="action-args" className="field mt-2 min-h-28 font-mono text-xs" value={actionArgsDraft} onChange={(event) => setActionArgsDraft(event.target.value.slice(0, 6000))} maxLength={6000} /><div className="mt-2 flex gap-2"><button className="button button-primary flex-1" type="submit">Review updated action</button><button className="button button-secondary" type="button" onClick={() => { setEditingAction(false); setActionArgsError(""); }}>Discard edit</button></div>{actionArgsError && <p className="mt-2 text-xs text-red-700" role="alert">{actionArgsError}</p>}<p className="mt-2 text-[11px] text-muted">Changes create a new approval request. They will not execute until you approve the revised action.</p></form> : <details className="mt-3 rounded-lg border border-line bg-white/70 p-2 text-xs"><summary className="cursor-pointer font-medium">Inspect exact action payload</summary><pre className="mt-2 max-h-36 overflow-auto whitespace-pre-wrap break-all">{JSON.stringify(agentTask.snapshot.pendingToolEnvelope.arguments, null, 2)}</pre></details>}</>}
        <p className="mt-2 text-[11px] text-muted">Approval applies once to this exact action and current page snapshot. Page instructions cannot change this approval.</p>
        <div className="mt-3 flex gap-2"><button className="button button-primary flex-1" disabled={approvalSeconds === 0 || editingAction} onClick={() => onApproveAction?.(pendingApproval.approvalToken, true)}>Approve once</button>{!editingAction && agentTask.snapshot.pendingToolEnvelope && <button className="button button-secondary" disabled={approvalSeconds === 0} onClick={() => { setActionArgsDraft(JSON.stringify(agentTask.snapshot.pendingToolEnvelope!.arguments, null, 2)); setEditingAction(true); }}>Edit</button>}<button className="button button-secondary" onClick={() => onApproveAction?.(pendingApproval.approvalToken, false)}>Cancel task</button></div>
      </article>}
      {agentTask?.snapshot.state === "NeedsUserInput" && <form className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4" onSubmit={(event) => { event.preventDefault(); if (clarification.trim()) { onClarification?.(clarification.trim()); setClarification(""); } }}>
        <span className="eyebrow">Atlas needs your input</span>
        {agentTask.spec.ambiguities.map((item) => <p className="mt-2 text-xs leading-5 text-muted" key={item}>{item}</p>)}
        <input className="field mt-3" aria-label="Clarification" value={clarification} onChange={(event) => setClarification(event.target.value.slice(0, 1000))} placeholder="Add a clarification" maxLength={1000} required />
        <button className="button button-primary mt-3 w-full" type="submit">Continue</button>
      </form>}
      {agentTask?.snapshot.error && <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900" role="status">{agentTask.snapshot.error.message}</p>}
      {activeTab && (
        <article className="mt-4 rounded-2xl border border-line bg-white p-4">
          <span className="eyebrow">Active page</span>
          <h3 className="mt-2 line-clamp-2 text-sm font-medium text-ink">{activeTab.title || "Untitled page"}</h3>
          <p className="mt-1 truncate text-xs text-muted">{activeTab.url}</p>
          {activeTab.text && <p className="mt-3 line-clamp-5 whitespace-pre-wrap text-xs leading-5 text-muted">{activeTab.text}</p>}
        </article>
      )}
    </section>
  );
}

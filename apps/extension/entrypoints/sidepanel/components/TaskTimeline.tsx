import type { ActiveTabSummary, UiTask } from "@atlas/contracts";

type Props = { task: UiTask | null; activeTab: ActiveTabSummary | null };

const statusLabel: Record<UiTask["status"], string> = {
  draft: "Ready to run",
  running: "Running",
  paused: "Paused",
  completed: "Completed",
  failed: "Needs attention",
  cancelled: "Stopped",
};

export function TaskTimeline({ task, activeTab }: Props) {
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
        <p className="mt-4 border-t border-line pt-3 text-xs leading-5 text-muted">Task execution is being built in the next implementation phases. Your task is saved locally and will not submit forms or make changes yet.</p>
      </article>
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

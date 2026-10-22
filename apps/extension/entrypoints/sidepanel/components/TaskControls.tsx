import type { UiTask } from "@atlas/contracts";

type Props = { task: UiTask | null; busy: boolean; onControl: (action: "run" | "pause" | "resume" | "stop") => void };

export function TaskControls({ task, busy, onControl }: Props) {
  const active = task?.status === "running" || task?.status === "paused";
  return (
    <div className="flex items-center gap-2 border-t border-line px-4 py-3">
      <button className="button button-primary flex-1" disabled={!task || busy || task.status === "running"} onClick={() => onControl(task?.status === "paused" ? "resume" : "run")}>
        {task?.status === "paused" ? "Resume" : "Run task"}
      </button>
      <button className="button button-secondary" disabled={!task || busy || task.status !== "running"} onClick={() => onControl("pause")}>Pause</button>
      <button className="button button-danger" disabled={!active || busy} onClick={() => onControl("stop")}>Stop</button>
    </div>
  );
}

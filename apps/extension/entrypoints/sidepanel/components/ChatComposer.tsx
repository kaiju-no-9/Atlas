import { useState, type FormEvent } from "react";

type Props = { busy: boolean; onSubmit: (goal: string) => Promise<boolean> };

export function ChatComposer({ busy, onSubmit }: Props) {
  const [goal, setGoal] = useState("");
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = goal.trim();
    if (!value || busy) return;
    if (await onSubmit(value)) setGoal("");
  };

  return (
    <form className="border-t border-line bg-white p-4" onSubmit={submit}>
      <label className="sr-only" htmlFor="task-goal">What would you like Atlas to do?</label>
      <textarea
        id="task-goal"
        className="composer"
        value={goal}
        onChange={(event) => setGoal(event.target.value.slice(0, 2000))}
        placeholder="Ask Atlas to research, compare, or prepare a form…"
        rows={3}
        maxLength={2000}
        disabled={busy}
      />
      <div className="mt-3 flex items-center justify-between">
        <span className="text-xs text-muted">Atlas will ask before consequential actions.</span>
        <button className="button button-primary" type="submit" disabled={busy || !goal.trim()}>
          {busy ? "Saving…" : "Add task"}
        </button>
      </div>
    </form>
  );
}

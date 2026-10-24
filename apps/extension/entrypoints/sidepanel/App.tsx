import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import { ActiveTabSummarySchema, UiTaskSchema } from "@atlas/contracts";
import { ChatComposer } from "./components/ChatComposer";
import { SettingsView } from "./components/SettingsView";
import { TaskControls } from "./components/TaskControls";
import { TaskTimeline } from "./components/TaskTimeline";
import { useUiStore } from "./store/useUiStore";
import { sendMessage } from "../../src/protocol/client";
import { TaskSpecSchema } from "../../src/agent/types";
import { TaskSnapshotSchema } from "../../src/agent/states";

const ChatListSchema = z.array(z.object({
  task: UiTaskSchema,
}));
const AgentTaskSchema = z.object({ snapshot: TaskSnapshotSchema, spec: TaskSpecSchema });

export default function App() {
  const { view, activeTab, task, loading, error, setView, setActiveTab, setTask, setLoading, setError } = useUiStore();
  const [busy, setBusy] = useState(false);
  const [agentTask, setAgentTask] = useState<z.infer<typeof AgentTaskSchema> | null>(null);
  const refreshVersion = useRef(0);

  const refresh = useCallback(async () => {
    const version = ++refreshVersion.current;
    setLoading(true);
    try {
      const [tabResult, tasksResult, agentResult] = await Promise.all([
        sendMessage({ type: "GET_ACTIVE_TAB" }),
        sendMessage({ type: "GET_TASKS" }),
        sendMessage({ type: "GET_AGENT_TASK" }),
      ]);
      const tab = ActiveTabSummarySchema.safeParse(tabResult);
      if (version !== refreshVersion.current) return;
      setActiveTab(tab.success ? tab.data : null);
      const chats = ChatListSchema.safeParse(tasksResult);
      if (!chats.success) throw new Error("Stored tasks could not be read.");
      setTask(chats.data[0]?.task ?? null);
      const parsedAgent = AgentTaskSchema.safeParse(agentResult);
      setAgentTask(parsedAgent.success ? parsedAgent.data : null);
      setError(null);
    } catch (cause) {
      if (version === refreshVersion.current) {
        setError(cause instanceof Error ? cause.message : "Atlas could not load this page.");
      }
    } finally {
      if (version === refreshVersion.current) setLoading(false);
    }
  }, [setActiveTab, setError, setLoading, setTask]);

  useEffect(() => {
    void refresh();
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === "local" && Object.keys(changes).some((key) => key.startsWith("atlas_chat_") || key.startsWith("atlas_agent_task_"))) void refresh();
    };
    const onTabActivated = () => void refresh();
    const onTabUpdated = (_tabId: number, changeInfo: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) => {
      if (tab.active && (changeInfo.status === "complete" || changeInfo.url !== undefined)) void refresh();
    };
    chrome.storage.onChanged.addListener(onChanged);
    chrome.tabs.onActivated.addListener(onTabActivated);
    chrome.tabs.onUpdated.addListener(onTabUpdated);
    return () => {
      chrome.storage.onChanged.removeListener(onChanged);
      chrome.tabs.onActivated.removeListener(onTabActivated);
      chrome.tabs.onUpdated.removeListener(onTabUpdated);
    };
  }, [refresh]);

  const startTask = async (goal: string): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      await sendMessage({ type: "START_TASK", goal });
      await refresh();
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save the task.");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const controlTask = async (action: "run" | "pause" | "resume" | "stop") => {
    setBusy(true);
    setError(null);
    try {
      await sendMessage({ type: "TASK_CONTROL", action });
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update the task.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="flex h-screen min-h-[520px] flex-col bg-canvas text-ink">
      <header className="flex items-center justify-between border-b border-line bg-white px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="grid h-9 w-9 place-items-center rounded-xl bg-ink text-sm font-semibold text-white" aria-hidden="true">A</div>
          <div><h1 className="text-sm font-semibold tracking-tight">Atlas</h1><p className="text-[11px] text-muted">Browser agent</p></div>
        </div>
        <div className="flex items-center gap-1 rounded-lg bg-canvas p-1" role="group" aria-label="Main navigation">
          <button className={`nav-button ${view === "chat" ? "nav-button-active" : ""}`} onClick={() => setView("chat")}>Tasks</button>
          <button className={`nav-button ${view === "settings" ? "nav-button-active" : ""}`} onClick={() => setView("settings")}>Settings</button>
        </div>
      </header>

      {view === "settings" ? <SettingsView onBack={() => setView("chat")} /> : <>
        {error && <div className="mx-4 mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">{error}</div>}
        {loading ? <div className="flex flex-1 items-center justify-center text-sm text-muted" role="status">Loading current page…</div> : <TaskTimeline task={task} activeTab={activeTab} agentTask={agentTask} onApproveAction={(approvalToken, approved) => void sendMessage({ type: "APPROVE_AGENT_ACTION", approvalToken, approved }).then(refresh).catch((cause) => setError(cause instanceof Error ? cause.message : "Approval could not be applied."))} onClarification={(answer) => void sendMessage({ type: "PROVIDE_AGENT_CLARIFICATION", answer }).then(refresh).catch((cause) => setError(cause instanceof Error ? cause.message : "Clarification could not be applied."))} />}
        <TaskControls task={task} busy={busy} onControl={(action) => void controlTask(action)} />
        <ChatComposer busy={busy} onSubmit={startTask} />
      </>}
    </main>
  );
}

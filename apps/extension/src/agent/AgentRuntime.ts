import type { PageObservation } from "../perception/types.ts";
import type { AgentGateway } from "../protocol/MessageRouter.ts";
import { ChromeToolAdapter } from "../browser/ChromeToolAdapter.ts";
import { ScriptInjector } from "../browser/ScriptInjector.ts";
import { PolicyEngine } from "../policy/engine.ts";
import type { StorageRepository } from "../storage/StorageRepository.ts";
import { TaskRepository } from "./TaskRepository.ts";
import { TaskCompiler } from "./compiler.ts";
import { TaskController } from "./controller.ts";
import { OpenRouterPlanner } from "./OpenRouterPlanner.ts";
import { OpenRouterProvider } from "./provider.ts";
import { TERMINAL_STATES, WAITING_STATES } from "./states.ts";

/** Trusted service-worker runtime that assembles the provider, controller, browser tools, and storage. */
export class AgentRuntime implements AgentGateway {
  private readonly chats: StorageRepository;
  private readonly tasks: TaskRepository;
  private readonly controller: TaskController;

  constructor(chats: StorageRepository, provider: OpenRouterProvider, injector = new ScriptInjector()) {
    this.chats = chats;
    this.tasks = new TaskRepository();
    const observer = {
      captureSnapshot: async (taskId: string, tabId: number, mode: "interactive") =>
        await injector.observePage(tabId, taskId, mode) as unknown as PageObservation,
    };
    const planner = new OpenRouterPlanner(provider);
    this.controller = new TaskController(this.tasks, new TaskCompiler(provider), observer,
      new ChromeToolAdapter(injector).createPipeline(), new PolicyEngine(), planner);
  }

  async start(taskId: string, goal: string): Promise<void> {
    const tab = await chrome.tabs.query({ active: true, lastFocusedWindow: true }).then((tabs) => tabs[0]);
    if (tab?.id === undefined) throw new Error("Open a browser tab before starting a task.");
    await this.controller.compileTask(taskId, goal, tab.id);
  }

  async latest(): Promise<unknown> {
    const [entry] = await this.chats.getChatIndex();
    if (!entry) return null;
    const chat = await this.chats.getChat(entry.chatId);
    if (!chat) return null;
    const snapshot = await this.tasks.getTaskSnapshot(chat.task.taskId);
    if (!snapshot) return null;
    const spec = await this.tasks.getTaskSpec(chat.task.taskId);
    return { snapshot, spec };
  }

  async control(action: "run" | "pause" | "resume" | "stop"): Promise<unknown> {
    const current = await this.latestWithTaskId();
    if (!current) throw new Error("There is no agent task to control.");
    let snapshot = current.snapshot;
    if (action === "run") {
      if (snapshot.state === "AwaitingPlanApproval") snapshot = await this.controller.approvePlan(snapshot.taskId, true);
      else if (snapshot.state === "Paused") snapshot = await this.controller.resume(snapshot.taskId);
      else if (snapshot.state !== "Observing" && snapshot.state !== "Planning" && snapshot.state !== "Executing" && snapshot.state !== "Verifying" && snapshot.state !== "Recovering") {
        throw new Error("This task is not ready to run.");
      }
      await this.chats.updateTaskStatus(current.chatId, "running");
      return this.pump(snapshot.taskId);
    }
    if (action === "resume") {
      snapshot = await this.controller.resume(snapshot.taskId);
      await this.chats.updateTaskStatus(current.chatId, "running");
      return this.pump(snapshot.taskId);
    }
    if (action === "pause") {
      snapshot = await this.controller.pause(snapshot.taskId);
      await this.chats.updateTaskStatus(current.chatId, "paused");
      return { snapshot, spec: current.spec };
    }
    snapshot = await this.controller.cancel(snapshot.taskId);
    await this.chats.updateTaskStatus(current.chatId, "cancelled");
    return { snapshot, spec: current.spec };
  }

  async approveAction(token: string, approved: boolean): Promise<unknown> {
    const current = await this.latestWithTaskId();
    if (!current) throw new Error("There is no agent task to approve.");
    const snapshot = await this.controller.approveAction(current.snapshot.taskId, token, approved);
    return this.pump(snapshot.taskId);
  }

  async provideClarification(answer: string): Promise<unknown> {
    const current = await this.latestWithTaskId();
    if (!current) throw new Error("There is no agent task awaiting clarification.");
    const snapshot = await this.controller.provideClarification(current.snapshot.taskId, answer);
    if (snapshot.state === "Planning") return this.pump(snapshot.taskId);
    if (snapshot.state === "Failed") await this.chats.updateTaskStatus(current.chatId, "failed");
    return { snapshot, spec: await this.tasks.getTaskSpec(snapshot.taskId) };
  }

  async recover(): Promise<void> {
    const index = await this.chats.getChatIndex();
    for (const entry of index) {
      const chat = await this.chats.getChat(entry.chatId);
      if (!chat || chat.task.status !== "running") continue;
      const snapshot = await this.tasks.getTaskSnapshot(chat.task.taskId);
      if (!snapshot || TERMINAL_STATES.has(snapshot.state) || WAITING_STATES.has(snapshot.state)) continue;
      await this.pump(snapshot.taskId);
    }
  }

  private async pump(taskId: string): Promise<unknown> {
    let snapshot = await this.tasks.getTaskSnapshot(taskId);
    if (!snapshot) throw new Error("The saved agent task could not be restored.");
    const spec = await this.tasks.getTaskSpec(taskId);
    for (let tick = 0; tick < 6; tick += 1) {
      if (TERMINAL_STATES.has(snapshot.state) || WAITING_STATES.has(snapshot.state)) break;
      snapshot = await this.controller.tick(taskId);
    }
    if (!TERMINAL_STATES.has(snapshot.state) && !WAITING_STATES.has(snapshot.state)) {
      await chrome.alarms.create("atlas_task_recovery_heartbeat", { delayInMinutes: 0.5, periodInMinutes: 1 });
    }
    if (snapshot.state === "Completed" || snapshot.state === "Failed" || snapshot.state === "Cancelled") {
      for (const item of await this.chats.getChatIndex()) {
        const record = await this.chats.getChat(item.chatId);
        if (record?.task.taskId === taskId) {
          await this.chats.updateTaskStatus(item.chatId, snapshot.state.toLowerCase() as "completed" | "failed" | "cancelled");
          break;
        }
      }
    }
    return { snapshot, spec };
  }

  private async latestWithTaskId(): Promise<{ chatId: string; snapshot: NonNullable<Awaited<ReturnType<TaskRepository["getTaskSnapshot"]>>>; spec: Awaited<ReturnType<TaskRepository["getTaskSpec"]>> } | null> {
    const [entry] = await this.chats.getChatIndex();
    if (!entry) return null;
    const chat = await this.chats.getChat(entry.chatId);
    if (!chat) return null;
    const snapshot = await this.tasks.getTaskSnapshot(chat.task.taskId);
    if (!snapshot) return null;
    return { chatId: entry.chatId, snapshot, spec: await this.tasks.getTaskSpec(chat.task.taskId) };
  }
}

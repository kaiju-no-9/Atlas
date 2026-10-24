import { RuntimeMessageSchema, type RuntimeMessage } from "../../../../packages/contracts/src/messages.ts";
import type { StorageRepository } from "../storage/StorageRepository.ts";
import type { TabManager } from "../browser/TabManager.ts";
import type { ScriptInjector } from "../browser/ScriptInjector.ts";
import { logger } from "../shared/logger.ts";

export interface AgentGateway {
  start(taskId: string, goal: string): Promise<void>;
  latest(): Promise<unknown>;
  control(action: "run" | "pause" | "resume" | "stop"): Promise<unknown>;
  approveAction(token: string, approved: boolean): Promise<unknown>;
  provideClarification(answer: string): Promise<unknown>;
  recover(): Promise<void>;
}

export class MessageRouter {
  private readonly storage: StorageRepository;
  private readonly tabs: TabManager;
  private readonly scripts: ScriptInjector;
  private readonly testProviderConnection?: (apiKey: string, model: string) => Promise<{ success: boolean; latencyMs: number; error?: string }>;
  private readonly agent?: AgentGateway;

  constructor(
    storage: StorageRepository,
    tabs: TabManager,
    scripts: ScriptInjector,
    testProviderConnection?: (apiKey: string, model: string) => Promise<{ success: boolean; latencyMs: number; error?: string }>,
    agent?: AgentGateway,
  ) {
    this.storage = storage;
    this.tabs = tabs;
    this.scripts = scripts;
    this.testProviderConnection = testProviderConnection;
    this.agent = agent;
  }

  async handle(rawMessage: unknown, sender: chrome.runtime.MessageSender): Promise<unknown> {
    const message = RuntimeMessageSchema.parse(rawMessage);
    if (sender.id !== chrome.runtime.id) throw new Error("Messages must originate from this extension.");

    switch (message.type) {
      case "GET_ACTIVE_TAB":
        return this.getActiveTab();
      case "GET_SETTINGS": {
        const settings = await this.storage.getSettings();
        return {
          provider: settings.provider,
          model: settings.model,
          rememberKey: settings.rememberKey,
          hasApiKey: settings.apiKey.length > 0,
        };
      }
      case "TEST_PROVIDER_CONNECTION": {
        if (!this.testProviderConnection) throw new Error("Provider connection checks are unavailable.");
        if (message.provider !== "openrouter") throw new Error("This provider is not supported yet. Select OpenRouter.");
        const settings = await this.storage.getSettings();
        const key = message.apiKey.trim() || settings.apiKey;
        if (!key) throw new Error("Enter an OpenRouter API key first.");
        return this.testProviderConnection(key, message.model);
      }
      case "SAVE_SETTINGS": {
        const settings = await this.storage.saveSettings(message.settings);
        return { provider: settings.provider, model: settings.model, rememberKey: settings.rememberKey, hasApiKey: !!settings.apiKey };
      }
      case "START_TASK": {
        const record = await this.storage.createTask(message.goal);
        await this.agent?.start(record.task.taskId, message.goal);
        return { chatId: record.chatId, task: record.task };
      }
      case "GET_TASKS":
        return this.storage.getRecentChats();
      case "GET_AGENT_TASK":
        return this.agent?.latest() ?? null;
      case "TASK_CONTROL":
        if (this.agent) return this.agent.control(message.action);
        return this.updateLatestTask(message);
      case "APPROVE_AGENT_ACTION":
        if (!this.agent) throw new Error("Agent execution is unavailable.");
        return this.agent.approveAction(message.approvalToken, message.approved);
      case "PROVIDE_AGENT_CLARIFICATION":
        if (!this.agent) throw new Error("Agent execution is unavailable.");
        return this.agent.provideClarification(message.answer);
    }
  }

  private async getActiveTab(): Promise<unknown> {
    const tab = await this.tabs.getActiveTab();
    if (!tab?.id) return null;
    let text = "";
    try {
      text = await this.scripts.readVisibleText(tab.id);
    } catch {
      // Restricted browser pages cannot be inspected with activeTab.
    }
    if (!tab.url) return null;
    return {
      tabId: tab.id,
      title: tab.title ?? "Untitled page",
      url: tab.url,
      text,
      capturedAt: new Date().toISOString(),
    };
  }

  private async updateLatestTask(message: Extract<RuntimeMessage, { type: "TASK_CONTROL" }>): Promise<unknown> {
    const [latest] = await this.storage.getChatIndex();
    if (!latest) return null;
    const nextStatus = {
      run: "running",
      resume: "running",
      pause: "paused",
      stop: "cancelled",
    }[message.action] as "running" | "paused" | "cancelled";
    const updated = await this.storage.updateTaskStatus(latest.chatId, nextStatus);
    return updated?.task ?? null;
  }

  async checkPendingTasks(): Promise<void> {
    const chats = await this.storage.getRecentChats();
    const pending = chats.filter(({ task }) => task.status === "running" || task.status === "paused");
    logger.info("Recovery heartbeat inspected persisted tasks", { pendingCount: pending.length });
    await this.agent?.recover();
  }
}

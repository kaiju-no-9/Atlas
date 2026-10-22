import { RuntimeMessageSchema, type RuntimeMessage } from "../../../../packages/contracts/src/messages.ts";
import type { StorageRepository } from "../storage/StorageRepository.ts";
import type { TabManager } from "../browser/TabManager.ts";
import type { ScriptInjector } from "../browser/ScriptInjector.ts";
import { logger } from "../shared/logger.ts";

export class MessageRouter {
  private readonly storage: StorageRepository;
  private readonly tabs: TabManager;
  private readonly scripts: ScriptInjector;

  constructor(
    storage: StorageRepository,
    tabs: TabManager,
    scripts: ScriptInjector,
  ) {
    this.storage = storage;
    this.tabs = tabs;
    this.scripts = scripts;
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
      case "SAVE_SETTINGS": {
        const settings = await this.storage.saveSettings(message.settings);
        return { provider: settings.provider, model: settings.model, rememberKey: settings.rememberKey, hasApiKey: !!settings.apiKey };
      }
      case "START_TASK": {
        const record = await this.storage.createTask(message.goal);
        return { chatId: record.chatId, task: record.task };
      }
      case "GET_TASKS":
        return this.storage.getRecentChats();
      case "TASK_CONTROL":
        return this.updateLatestTask(message);
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
  }
}

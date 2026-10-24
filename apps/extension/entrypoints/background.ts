import { MessageRouter } from "../src/protocol/MessageRouter";
import { TabManager } from "../src/browser/TabManager";
import { ScriptInjector } from "../src/browser/ScriptInjector";
import { StorageRepository } from "../src/storage/StorageRepository";
import { logger } from "../src/shared/logger";
import { ensureRecoveryAlarm, RECOVERY_ALARM_NAME } from "../src/shared/recoveryAlarm";
import { OpenRouterProvider } from "../src/agent/provider";
import { AgentRuntime } from "../src/agent/AgentRuntime";

export default defineBackground(() => {
  const storage = new StorageRepository();
  const provider = new OpenRouterProvider(
    async () => {
      const settings = await storage.getSettings();
      if (settings.provider !== "openrouter") throw new Error("UNSUPPORTED_PROVIDER: Select OpenRouter to run tasks.");
      return settings.apiKey || null;
    },
    async () => (await storage.getSettings()).model,
  );
  const injector = new ScriptInjector();
  const agent = new AgentRuntime(storage, provider, injector);
  const router = new MessageRouter(storage, new TabManager(), injector, (apiKey, model) => provider.testConnection(apiKey, model), agent);

  void storage.initialize().catch((error: unknown) => {
    logger.error("Storage initialization failed", { error: error instanceof Error ? error.message : "unknown" });
  });
  void ensureRecoveryAlarm().catch((error: unknown) => {
    logger.error("Recovery alarm initialization failed", { error: error instanceof Error ? error.message : "unknown" });
  });

  chrome.runtime.onInstalled.addListener(() => {
    void storage.initialize().catch((error: unknown) => {
      logger.error("Extension installation initialization failed", { error: error instanceof Error ? error.message : "unknown" });
    });
  });
  chrome.runtime.onStartup.addListener(() => {
    void storage.initialize().catch((error: unknown) => {
      logger.error("Browser startup initialization failed", { error: error instanceof Error ? error.message : "unknown" });
    });
    void ensureRecoveryAlarm().catch((error: unknown) => {
      logger.error("Recovery alarm initialization failed", { error: error instanceof Error ? error.message : "unknown" });
    });
  });
  chrome.action.onClicked.addListener(async (tab) => {
    if (tab.id !== undefined) await chrome.sidePanel.open({ tabId: tab.id });
  });
  chrome.runtime.onMessage.addListener((rawMessage, sender, sendResponse) => {
    void router.handle(rawMessage, sender)
      .then((data) => sendResponse({ success: true, data }))
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "The request could not be completed.";
        logger.error("Message handling failed", { error: message });
        sendResponse({ success: false, error: message });
      });
    return true;
  });
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === RECOVERY_ALARM_NAME) {
      void router.checkPendingTasks().catch((error: unknown) => {
        logger.error("Recovery heartbeat failed", { error: error instanceof Error ? error.message : "unknown" });
      });
    }
  });
});

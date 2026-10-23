import { ChatIndexSchema, ChatRecordSchema, SettingsSchema, type ChatIndexRecord, type ChatRecord, type SettingsRecord } from "./types.ts";
import { migrateStorage } from "./Migrations.ts";
import { WriteQueue } from "./WriteQueue.ts";

const SETTINGS_KEY = "atlas_settings";
const CHAT_INDEX_KEY = "atlas_chat_index";
const CHAT_PREFIX = "atlas_chat_";

export class StorageRepository {
  private readonly writes = new WriteQueue();
  private initialization: Promise<void> | null = null;

  async initialize(): Promise<void> {
    if (this.initialization) return this.initialization;
    this.initialization = this.initializeOnce().catch((error: unknown) => {
      this.initialization = null;
      throw error;
    });
    return this.initialization;
  }

  private async initializeOnce(): Promise<void> {
    await chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
    await chrome.storage.session.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
    await migrateStorage();
    const { [CHAT_INDEX_KEY]: rawIndex } = await chrome.storage.local.get(CHAT_INDEX_KEY);
    if (rawIndex === undefined) await chrome.storage.local.set({ [CHAT_INDEX_KEY]: [] });
  }

  async getSettings(): Promise<SettingsRecord> {
    await this.initialize();
    const [{ [SETTINGS_KEY]: rawLocal }, session] = await Promise.all([
      chrome.storage.local.get(SETTINGS_KEY),
      chrome.storage.session.get(SETTINGS_KEY),
    ]);
    const raw = rawLocal ?? session[SETTINGS_KEY];
    if (raw !== undefined) {
      const parsed = SettingsSchema.safeParse(raw);
      if (parsed.success) return parsed.data;
    }
    return {
      schemaVersion: 1,
      provider: "openrouter",
      model: "openai/gpt-4o-mini",
      rememberKey: false,
      apiKey: "",
      updatedAt: new Date().toISOString(),
    };
  }

  async saveSettings(input: Omit<SettingsRecord, "schemaVersion" | "updatedAt"> & { clearKey: boolean }): Promise<SettingsRecord> {
    await this.initialize();
    return this.writes.run(SETTINGS_KEY, async () => {
      const current = await this.getSettings();
      const record = SettingsSchema.parse({
        ...input,
        apiKey: input.clearKey ? "" : input.apiKey || current.apiKey,
        schemaVersion: 1,
        updatedAt: new Date().toISOString(),
      });
      const area = record.rememberKey ? chrome.storage.local : chrome.storage.session;
      const otherArea = record.rememberKey ? chrome.storage.session : chrome.storage.local;

      // Remove the key from its old location first. If the new write fails,
      // losing a key is safer than leaving it persisted against user intent.
      await otherArea.remove(SETTINGS_KEY);
      await area.set({ [SETTINGS_KEY]: record });
      return record;
    });
  }

  async clearApiKey(): Promise<void> {
    await this.initialize();
    await this.writes.run(SETTINGS_KEY, async () => {
      const { [SETTINGS_KEY]: raw } = await chrome.storage.local.get(SETTINGS_KEY);
      await chrome.storage.local.remove(SETTINGS_KEY);
      await chrome.storage.session.remove(SETTINGS_KEY);
      if (raw) {
        await chrome.storage.local.set({ [SETTINGS_KEY]: { ...raw, apiKey: "", rememberKey: false } });
      }
    });
  }

  async createTask(goal: string): Promise<ChatRecord> {
    await this.initialize();
    const now = new Date().toISOString();
    const taskId = crypto.randomUUID();
    const chatId = crypto.randomUUID();
    const record = ChatRecordSchema.parse({
      schemaVersion: 1,
      chatId,
      task: { taskId, goal, status: "draft", createdAt: now, updatedAt: now },
      events: [{ id: crypto.randomUUID(), type: "user", text: goal, createdAt: now }],
    });
    await this.writes.run(CHAT_INDEX_KEY, async () => {
      const index = await this.getChatIndex();
      const nextIndex = ChatIndexSchema.parse([{ chatId, title: goal, updatedAt: now }, ...index].slice(0, 100));
      await Promise.all([
        chrome.storage.local.set({ [CHAT_PREFIX + chatId]: record }),
        chrome.storage.local.set({ [CHAT_INDEX_KEY]: nextIndex }),
      ]);
    });
    return record;
  }

  async getChatIndex(): Promise<ChatIndexRecord> {
    await this.initialize();
    const { [CHAT_INDEX_KEY]: raw = [] } = await chrome.storage.local.get(CHAT_INDEX_KEY);
    const parsed = ChatIndexSchema.safeParse(raw);
    return parsed.success ? parsed.data : [];
  }

  async getChat(chatId: string): Promise<ChatRecord | undefined> {
    await this.initialize();
    const { [CHAT_PREFIX + chatId]: raw } = await chrome.storage.local.get(CHAT_PREFIX + chatId);
    const parsed = ChatRecordSchema.safeParse(raw);
    return parsed.success ? parsed.data : undefined;
  }

  async getRecentChats(): Promise<ChatRecord[]> {
    await this.initialize();
    const index = await this.getChatIndex();
    const records = await Promise.all(index.map(({ chatId }) => this.getChat(chatId)));
    return records.filter((record): record is ChatRecord => record !== undefined);
  }

  async updateTaskStatus(chatId: string, status: ChatRecord["task"]["status"]): Promise<ChatRecord | undefined> {
    await this.initialize();
    return this.writes.run(CHAT_PREFIX + chatId, async () => {
      const record = await this.getChat(chatId);
      if (!record) return undefined;
      const now = new Date().toISOString();
      const updated = ChatRecordSchema.parse({
        ...record,
        task: { ...record.task, status, updatedAt: now },
        events: [...record.events, { id: crypto.randomUUID(), type: "status", text: `Task ${status}.`, createdAt: now }].slice(-500),
      });
      await chrome.storage.local.set({ [CHAT_PREFIX + chatId]: updated });
      return updated;
    });
  }
}

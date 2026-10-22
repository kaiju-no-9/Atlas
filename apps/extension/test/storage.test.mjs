import assert from "node:assert/strict";
import test from "node:test";
import { StorageRepository } from "../src/storage/StorageRepository.ts";

function createStorageArea() {
  const values = new Map();
  const accessLevels = [];
  return {
    values,
    accessLevels,
    async get(keys) {
      const names = keys === undefined ? [...values.keys()] : Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(names.filter((key) => values.has(key)).map((key) => [key, values.get(key)]));
    },
    async set(items) {
      for (const [key, value] of Object.entries(items)) values.set(key, structuredClone(value));
    },
    async remove(keys) {
      for (const key of Array.isArray(keys) ? keys : [keys]) values.delete(key);
    },
    async setAccessLevel(options) {
      accessLevels.push(options.accessLevel);
    },
  };
}

function createRepository() {
  const local = createStorageArea();
  const session = createStorageArea();
  globalThis.chrome = { storage: { local, session } };
  return { repository: new StorageRepository(), local, session };
}

test("restricts both storage areas to trusted contexts", async () => {
  const { repository, local, session } = createRepository();
  await repository.initialize();
  assert.deepEqual(local.accessLevels, ["TRUSTED_CONTEXTS"]);
  assert.deepEqual(session.accessLevels, ["TRUSTED_CONTEXTS"]);
});

test("keeps session-only API keys out of persistent local storage", async () => {
  const { repository, local, session } = createRepository();
  await repository.saveSettings({
    provider: "openrouter", model: "openai/gpt-4o-mini", rememberKey: false,
    apiKey: "sk-session-secret", clearKey: false,
  });
  assert.equal(local.values.has("atlas_settings"), false);
  assert.equal(session.values.get("atlas_settings").apiKey, "sk-session-secret");
  assert.equal((await repository.getSettings()).apiKey, "sk-session-secret");
});

test("persists opted-in settings and clears an existing key", async () => {
  const { repository, local, session } = createRepository();
  await repository.saveSettings({
    provider: "openai", model: "gpt-4o-mini", rememberKey: true,
    apiKey: "sk-persistent-secret", clearKey: false,
  });
  assert.equal(local.values.get("atlas_settings").apiKey, "sk-persistent-secret");
  assert.equal(session.values.has("atlas_settings"), false);

  await repository.saveSettings({
    provider: "openai", model: "gpt-4o-mini", rememberKey: false,
    apiKey: "", clearKey: true,
  });
  assert.equal(local.values.has("atlas_settings"), false);
  assert.equal(session.values.get("atlas_settings").apiKey, "");
});

test("stores tasks partitioned by chat ID and records status changes", async () => {
  const { repository, local } = createRepository();
  const created = await repository.createTask("Summarize the current page");
  assert.equal(local.values.has(`atlas_chat_${created.chatId}`), true);
  assert.equal((await repository.getChatIndex())[0].chatId, created.chatId);

  const [running, paused] = await Promise.all([
    repository.updateTaskStatus(created.chatId, "running"),
    repository.updateTaskStatus(created.chatId, "paused"),
  ]);
  assert.equal(running.task.status, "running");
  assert.equal(paused.task.status, "paused");
  assert.deepEqual(paused.events.slice(-2).map((event) => event.text), ["Task running.", "Task paused."]);
});

test("refuses to open storage written by a newer schema version", async () => {
  const { repository, local } = createRepository();
  local.values.set("atlas_schema_version", 2);
  await assert.rejects(repository.initialize(), /newer version/);
});

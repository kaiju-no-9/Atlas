import assert from "node:assert/strict";
import test from "node:test";
import { MessageRouter } from "../src/protocol/MessageRouter.ts";

test("stop control immediately persists a cancelled task state", async () => {
  globalThis.chrome = { runtime: { id: "atlas-test-extension" } };
  const updates = [];
  const storage = {
    async getChatIndex() {
      return [{ chatId: "chat-current", title: "Current task", updatedAt: new Date().toISOString() }];
    },
    async updateTaskStatus(chatId, status) {
      updates.push({ chatId, status });
      return { task: { status } };
    },
  };
  const router = new MessageRouter(storage, {}, {});

  const stopped = await router.handle({ type: "TASK_CONTROL", action: "stop" }, { id: "atlas-test-extension" });

  assert.deepEqual(updates, [{ chatId: "chat-current", status: "cancelled" }]);
  assert.deepEqual(stopped, { status: "cancelled" });
});

test("rejects messages that did not originate from this extension", async () => {
  globalThis.chrome = { runtime: { id: "atlas-test-extension" } };
  const router = new MessageRouter({}, {}, {});
  await assert.rejects(
    router.handle({ type: "GET_TASKS" }, { id: "another-extension" }),
    /originate from this extension/,
  );
});

test("recovery heartbeat inspects persisted running and paused tasks", async () => {
  const logged = [];
  globalThis.chrome = { runtime: { id: "atlas-test-extension" } };
  const storage = {
    async getRecentChats() {
      return [
        { task: { status: "running" } },
        { task: { status: "paused" } },
        { task: { status: "draft" } },
      ];
    },
  };
  const router = new MessageRouter(storage, {}, {});
  const originalInfo = console.info;
  console.info = (...args) => logged.push(args);
  try {
    await router.checkPendingTasks();
  } finally {
    console.info = originalInfo;
  }
  assert.equal(logged.length, 1);
  assert.deepEqual(logged[0][1], { pendingCount: 2 });
});

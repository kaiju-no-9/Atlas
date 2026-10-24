import assert from "node:assert/strict";
import { test } from "node:test";
import { ActionQueue, ActionQueueError } from "../src/browser/actionQueue.ts";
import { ToolSchemas, ToolRegistry } from "../src/tools/registry.ts";
import { ToolValidationPipeline } from "../src/tools/pipeline.ts";
import { ChromeToolAdapter } from "../src/browser/ChromeToolAdapter.ts";

test("per-tab queue serializes operations and allows another tab to proceed", async () => {
  const queue = new ActionQueue(1000);
  const order = [];
  let releaseFirst;
  const gate = new Promise((resolve) => { releaseFirst = resolve; });
  const first = queue.enqueue(1, async () => { order.push("first:start"); await gate; order.push("first:end"); return 1; });
  const second = queue.enqueue(1, async () => { order.push("second"); return 2; });
  const otherTab = queue.enqueue(2, async () => { order.push("other-tab"); return 3; });
  assert.equal(await otherTab, 3);
  assert.deepEqual(order, ["first:start", "other-tab"]);
  releaseFirst();
  assert.deepEqual(await Promise.all([first, second]), [1, 2]);
  assert.deepEqual(order, ["first:start", "other-tab", "first:end", "second"]);
});

test("a timeout rejects the caller and does not let the next mutation overlap", async () => {
  const queue = new ActionQueue(10);
  let releaseFirst;
  const gate = new Promise((resolve) => { releaseFirst = resolve; });
  const first = queue.enqueue(3, () => gate);
  const second = queue.enqueue(3, () => "second");
  await assert.rejects(first, ActionQueueError);
  let secondFinished = false;
  void second.then(() => { secondFinished = true; });
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(secondFinished, false);
  releaseFirst();
  assert.equal(await second, "second");
});

test("registry exposes every tool named by the specification", () => {
  const names = Object.keys(ToolSchemas);
  // The specification's table lists 17 tools although its objective says 16.
  assert.equal(names.length, 17);
  assert.deepEqual(Object.keys(ToolRegistry).sort(), [...names].sort());
  assert.equal(ToolSchemas.navigate.input.safeParse({ url: "javascript:alert(1)" }).success, false);
  assert.equal(ToolSchemas.navigate.input.safeParse({ url: "chrome://settings" }).success, false);
  assert.equal(ToolSchemas.navigate.input.safeParse({ url: "https://example.com" }).success, true);
  assert.equal(ToolSchemas.navigate.input.safeParse({ url: "http://localhost:5173" }).success, true);
  assert.equal(ToolSchemas.scroll_page.input.safeParse({ direction: "down", amount: 1201 }).success, false);
  assert.equal(ToolSchemas.press_key.input.safeParse({ key: "F12", modifiers: [] }).success, false);
});

test("every registered tool rejects unknown payload fields in input and output schemas", () => {
  for (const [name, schemas] of Object.entries(ToolSchemas)) {
    assert.equal(schemas.input.safeParse({ arbitraryJavaScript: "alert(1)" }).success, false, `${name} input must reject unknown fields`);
    assert.equal(schemas.output.safeParse({ arbitraryJavaScript: "alert(1)" }).success, false, `${name} output must reject unknown fields`);
  }
});

test("pipeline rejects unapproved high-risk text entry before adapter dispatch", async () => {
  let calls = 0;
  const pipeline = new ToolValidationPipeline(new ActionQueue(), async () => { calls += 1; return { typedLength: 3 }; });
  const taskId = "11111111-1111-4111-8111-111111111111";
  const callId = "22222222-2222-4222-8222-222222222222";
  const observationId = "33333333-3333-4333-8333-333333333333";
  const context = {
    taskId, tabId: 1, currentUrl: "https://example.com/page", taskStatus: "running", cancelRequested: false,
    allowedTools: new Set(["type_text"]), allowedOrigins: new Set(["https://example.com"]), activeObservationId: observationId, approvedActions: new Set(),
  };
  const result = await pipeline.execute({
    protocolVersion: 1, taskId, callId, tool: "type_text",
    arguments: { observationId, elementId: "el_1", text: "abc" }, reason: "Fill a field", expectedOutcome: "The field contains text",
  }, context);
  assert.equal(result.status, "rejected_policy");
  assert.equal(result.error?.code, "APPROVAL_REQUIRED");
  assert.equal(calls, 0);
});

test("pipeline fails closed when a page mutation has no outcome verifier", async () => {
  let calls = 0;
  const pipeline = new ToolValidationPipeline(new ActionQueue(), async () => { calls += 1; return { currentScrollY: 500, hitLimit: false }; });
  const taskId = "11111111-1111-4111-8111-111111111111";
  const callId = "22222222-2222-4222-8222-222222222222";
  const context = {
    taskId, tabId: 1, currentUrl: "https://example.com/page", taskStatus: "running", cancelRequested: false,
    allowedTools: new Set(["scroll_page"]), allowedOrigins: new Set(["https://example.com"]),
    activeObservationId: "33333333-3333-4333-8333-333333333333", approvedActions: new Set(),
  };
  const result = await pipeline.execute({
    protocolVersion: 1, taskId, callId, tool: "scroll_page", arguments: { direction: "down" },
    reason: "Inspect lower content", expectedOutcome: "The viewport moves down",
  }, context);
  assert.equal(calls, 1);
  assert.equal(result.status, "error");
  assert.equal(result.error?.code, "OUTCOME_UNVERIFIED");
});

test("Chrome adapter verifier checks typed input against a fresh observation", async () => {
  const adapter = new ChromeToolAdapter({ observePage: async () => ({
    observationId: "44444444-4444-4444-8444-444444444444", url: "https://example.com/form", fingerprint: "after",
    elements: [{ id: "el_1", tagName: "input", role: "textbox", name: "Email", placeholder: "you@example.com", value: "a@b.com" }],
  }) });
  const context = {
    taskId: "11111111-1111-4111-8111-111111111111", tabId: 1, currentUrl: "https://example.com/form", taskStatus: "running", cancelRequested: false,
    allowedTools: new Set(["type_text"]), allowedOrigins: new Set(["https://example.com"]), activeObservationId: "33333333-3333-4333-8333-333333333333",
    approvedActions: new Set(), activeObservation: { fingerprint: "before", elements: [{ id: "el_1", tagName: "input", role: "textbox", name: "Email", placeholder: "you@example.com", value: "a@" }] },
  };
  const verified = await adapter.verifyOutcome("type_text", { observationId: context.activeObservationId, elementId: "el_1", text: "b.com" }, { typedLength: 5 }, context);
  assert.equal(verified.verified, true);
  assert.equal(verified.observationId, "44444444-4444-4444-8444-444444444444");
});

test("Chrome adapter verifier rejects mutations whose expected state is absent", async () => {
  const adapter = new ChromeToolAdapter({ observePage: async () => ({
    observationId: "44444444-4444-4444-8444-444444444444", url: "https://example.com/form", fingerprint: "after",
    elements: [{ id: "el_1", tagName: "input", role: "textbox", name: "Email", placeholder: "you@example.com", value: "a@" }],
  }) });
  const context = {
    taskId: "11111111-1111-4111-8111-111111111111", tabId: 1, currentUrl: "https://example.com/form", taskStatus: "running", cancelRequested: false,
    allowedTools: new Set(["type_text"]), allowedOrigins: new Set(["https://example.com"]), activeObservationId: "33333333-3333-4333-8333-333333333333",
    approvedActions: new Set(), activeObservation: { fingerprint: "before", elements: [{ id: "el_1", tagName: "input", role: "textbox", name: "Email", placeholder: "you@example.com", value: "a@" }] },
  };
  const verified = await adapter.verifyOutcome("type_text", { observationId: context.activeObservationId, elementId: "el_1", text: "b.com" }, { typedLength: 5 }, context);
  assert.equal(verified.verified, false);
});

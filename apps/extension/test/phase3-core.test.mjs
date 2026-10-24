import assert from "node:assert/strict";
import { test } from "node:test";
import { TaskCompiler } from "../src/agent/compiler.ts";
import { assertTransition, TaskSnapshotSchema } from "../src/agent/states.ts";
import { PolicyEngine } from "../src/policy/engine.ts";
import { TaskController } from "../src/agent/controller.ts";
import { TaskRepository } from "../src/agent/TaskRepository.ts";
import { ActionQueue } from "../src/browser/actionQueue.ts";
import { ToolValidationPipeline } from "../src/tools/pipeline.ts";
import { OutcomeVerifier } from "../src/agent/verifier.ts";

const taskId = "11111111-1111-4111-8111-111111111111";

test("compiler bounds the task to active origin and never opts into provider disclosure", async () => {
  const compiler = new TaskCompiler({ compilePrompt: async () => ({
    goal: "Find the support email", category: "research", successCriteria: ["A support email is visible"],
    proposedPlan: [{ description: "Read page", expectedTool: "read_page_text" }],
    containsPII: true, sensitiveFieldTypes: ["email"],
  }) });
  const spec = await compiler.compile("Find the support email", "https://example.com/help", taskId);
  assert.equal(spec.id, taskId);
  assert.deepEqual(spec.allowedOrigins, ["https://example.com"]);
  assert.equal(spec.dataExposure.containsPII, true);
  assert.equal(spec.dataExposure.discloseToProvider, false);
  assert.equal(spec.budgets.maxTabs, 1);
  assert.ok(spec.allowedTools.includes("finish_task"));
});

test("compiler rejects malformed plan tool names and non-web starting pages", async () => {
  const compiler = new TaskCompiler({ compilePrompt: async () => ({
    goal: "Complete a task", category: "navigation", successCriteria: ["Done"],
    proposedPlan: [{ description: "Run arbitrary script", expectedTool: "execute_javascript" }],
  }) });
  await assert.rejects(compiler.compile("Complete a task", "https://example.com", taskId));
  await assert.rejects(compiler.compile("Complete a task", "chrome://settings", taskId));
});

test("compiler escalates consequential plan steps even when the provider labels them safe", async () => {
  const compiler = new TaskCompiler({ compilePrompt: async () => ({
    goal: "Submit the request", category: "form_filling", successCriteria: ["Request submitted"],
    proposedPlan: [{ description: "Submit the application", expectedTool: "click_element", requiresApproval: false }],
  }) });
  const spec = await compiler.compile("Submit the request", "https://example.com/form", taskId);
  assert.equal(spec.proposedPlan[0].requiresApproval, true);
});

test("policy requests approval for form writes and flags destructive intent", async () => {
  const policy = new PolicyEngine();
  const origin = new Set(["https://example.com"]);
  const envelope = (tool, reason, expectedOutcome, args = {}) => ({ protocolVersion: 1, taskId, callId: taskId, tool, arguments: args, reason, expectedOutcome });
  assert.equal(policy.classifyActionRisk(envelope("type_text", "Fill the search field", "Text appears"), "https://example.com/", origin).tier, 2);
  assert.equal(policy.classifyActionRisk(envelope("click_element", "Place order", "Purchase completed"), "https://example.com/", origin).tier, 3);
  assert.equal(policy.classifyActionRisk(envelope("navigate", "Open page", "URL changes", { url: "https://evil.example" }), "https://example.com/", origin).tier, 3);
});

test("state checkpoints validate payloads and reject impossible transitions", () => {
  const snapshot = TaskSnapshotSchema.parse({
    taskId, state: "AwaitingPlanApproval", stepCount: 0, activeTabId: 4,
    budgetsUsed: { steps: 0, tokens: 0, startTime: Date.now() }, recoveryAttemptsForCurrentStep: 0,
    consecutiveNoProgressSteps: 0, revision: 0, updatedAt: new Date().toISOString(),
  });
  assert.equal(snapshot.state, "AwaitingPlanApproval");
  assert.throws(() => assertTransition("AwaitingPlanApproval", "Executing"), /Invalid task transition/);
  assert.doesNotThrow(() => assertTransition("AwaitingPlanApproval", "Observing"));
});

test("deterministic verifier checks navigation and exact field values against before/after evidence", () => {
  const verifier = new OutcomeVerifier();
  const base = {
    observationId: "33333333-3333-4333-8333-333333333333", taskId, tabId: 4, url: "https://example.com/form", title: "Form", mode: "interactive", capturedAt: new Date().toISOString(),
    viewport: { width: 1000, height: 800, scrollX: 0, scrollY: 0, totalHeight: 800 }, fingerprint: "same", headings: [], landmarks: [], truncated: false, elementCount: 1,
    elements: [{ id: "el_1", tagName: "input", role: "textbox", name: "Email", disabled: false, readOnly: false, visible: true, inViewport: true, bounds: { x: 0, y: 0, width: 100, height: 20, top: 0, left: 0 }, value: "" }],
  };
  const envelope = (tool, args) => ({ protocolVersion: 1, taskId, callId: "22222222-2222-4222-8222-222222222222", tool, arguments: args, reason: "Verify the requested browser action", expectedOutcome: "The requested page state is visible" });
  const typed = verifier.verifyStep(envelope("type_text", { elementId: "el_1", text: "xyz", clearBefore: true }), base, { ...base, fingerprint: "changed", elements: [{ ...base.elements[0], value: "xyz" }] });
  assert.equal(typed.progressMade, true);
  assert.equal(typed.criteriaSatisfied, true);
  const navigated = verifier.verifyStep(envelope("navigate", { url: "https://example.com/done" }), base, { ...base, url: "https://example.com/done" });
  assert.equal(navigated.progressMade, true);
  assert.equal(navigated.confidence, "HIGH");
  const failed = verifier.verifyStep(envelope("type_text", { elementId: "el_1", text: "xyz", clearBefore: true }), base, base);
  assert.equal(failed.progressMade, false);
});

test("controller holds a Tier 2 write until an exact approval token is accepted", async () => {
  const values = new Map();
  globalThis.chrome = {
    tabs: { get: async () => ({ id: 4, url: "https://example.com/form" }) },
    storage: { local: {
      get: async (key) => typeof key === "string" ? { [key]: values.get(key) } : Object.fromEntries(key.map((item) => [item, values.get(item)])),
      set: async (entries) => { for (const [key, value] of Object.entries(entries)) values.set(key, value); },
    } },
  };
  const repo = new TaskRepository();
  const compiler = new TaskCompiler({ compilePrompt: async () => ({
    goal: "Fill this form", category: "form_filling", successCriteria: ["The field contains xyz"],
    proposedPlan: [{ description: "Type into the email field", expectedTool: "type_text", requiresApproval: true }],
  }) });
  let captures = 0;
  const observation = (fingerprint) => ({
    observationId: fingerprint === "before" ? "33333333-3333-4333-8333-333333333333" : "44444444-4444-4444-8444-444444444444",
    taskId, tabId: 4, url: "https://example.com/form", title: "Form", mode: "interactive", capturedAt: new Date().toISOString(),
    viewport: { width: 1000, height: 800, scrollX: 0, scrollY: 0, totalHeight: 800 }, fingerprint,
    headings: [], landmarks: [], truncated: false, elementCount: 1,
    elements: [{ id: "el_1", tagName: "input", role: "textbox", name: "Email", disabled: false, readOnly: false, visible: true, inViewport: true, bounds: { x: 0, y: 0, width: 100, height: 20, top: 0, left: 0 }, value: "" }],
  });
  const observer = { captureSnapshot: async () => observation(++captures === 1 ? "before" : "after") };
  let dispatched = 0;
  const pipeline = new ToolValidationPipeline(new ActionQueue(), async () => { dispatched += 1; return { typedLength: 3 }; }, async () => ({ verified: true }));
  const planner = { proposeNext: async () => ({ kind: "tool", envelope: {
    protocolVersion: 1, taskId, callId: "22222222-2222-4222-8222-222222222222", tool: "type_text",
    arguments: { observationId: "33333333-3333-4333-8333-333333333333", elementId: "el_1", text: "xyz" },
    reason: "Fill the email field", expectedOutcome: "The email field contains xyz",
  } }) };
  const controller = new TaskController(repo, compiler, observer, pipeline, new PolicyEngine(), planner);
  let state = await controller.compileTask(taskId, "Fill this form", 4);
  assert.equal(state.state, "AwaitingPlanApproval");
  state = await controller.approvePlan(taskId, true);
  state = await controller.tick(taskId);
  state = await controller.tick(taskId);
  assert.equal(state.state, "AwaitingActionApproval");
  assert.equal(dispatched, 0);
  await assert.rejects(controller.approveAction(taskId, "33333333-3333-4333-8333-333333333333", true), /missing, expired, or belongs/);
  state = await controller.approveAction(taskId, state.pendingApproval.approvalToken, true);
  assert.equal(state.state, "Executing");
  // A new controller and repository instance stand in for a service-worker restart.
  const restartedController = new TaskController(new TaskRepository(), compiler, observer, pipeline, new PolicyEngine(), planner);
  state = await restartedController.tick(taskId);
  assert.equal(state.state, "Verifying");
  assert.equal(dispatched, 1);
  assert.equal((await new TaskRepository().getToolResults(taskId)).length, 1);
});

test("controller halts after three consecutive actions with no verified progress", async () => {
  const values = new Map();
  globalThis.chrome = {
    tabs: { get: async () => ({ id: 4, url: "https://example.com/form" }) },
    storage: { local: {
      get: async (key) => typeof key === "string" ? { [key]: values.get(key) } : Object.fromEntries(key.map((item) => [item, values.get(item)])),
      set: async (entries) => { for (const [key, value] of Object.entries(entries)) values.set(key, value); },
    } },
  };
  const repo = new TaskRepository();
  const compiler = new TaskCompiler({ compilePrompt: async () => ({
    goal: "Fill this form", category: "form_filling", successCriteria: ["The field contains xyz"],
    proposedPlan: [{ description: "Type into the email field", expectedTool: "type_text", requiresApproval: true }],
  }) });
  const observation = () => ({
    observationId: crypto.randomUUID(), taskId, tabId: 4, url: "https://example.com/form", title: "Form", mode: "interactive", capturedAt: new Date().toISOString(),
    viewport: { width: 1000, height: 800, scrollX: 0, scrollY: 0, totalHeight: 800 }, fingerprint: "unchanged", headings: [], landmarks: [], truncated: false, elementCount: 1,
    elements: [{ id: "el_1", tagName: "input", role: "textbox", name: "Email", disabled: false, readOnly: false, visible: true, inViewport: true, bounds: { x: 0, y: 0, width: 100, height: 20, top: 0, left: 0 }, value: "" }],
  });
  const observer = { captureSnapshot: async () => observation() };
  const pipeline = new ToolValidationPipeline(new ActionQueue(), async () => ({ typedLength: 3 }), async () => ({ verified: true }));
  const planner = { proposeNext: async (_task, current) => ({ kind: "tool", envelope: {
    protocolVersion: 1, taskId, callId: crypto.randomUUID(), tool: "type_text",
    arguments: { observationId: current.observationId, elementId: "el_1", text: "xyz", clearBefore: true },
    reason: "Fill the email field", expectedOutcome: "The email field contains xyz",
  } }) };
  const controller = new TaskController(repo, compiler, observer, pipeline, new PolicyEngine(), planner);
  await controller.compileTask(taskId, "Fill this form", 4);
  await controller.approvePlan(taskId, true);
  let state;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await controller.tick(taskId); // Observe
    state = await controller.tick(taskId); // Propose and await action approval
    assert.equal(state.state, "AwaitingActionApproval");
    state = await controller.approveAction(taskId, state.pendingApproval.approvalToken, true);
    state = await controller.tick(taskId); // Execute
    state = await controller.tick(taskId); // Verify
    if (attempt < 2) {
      assert.equal(state.state, "Recovering");
      state = await controller.tick(taskId);
    }
  }
  assert.equal(state.state, "Failed");
  assert.equal(state.error.code, "STUCK_LOOP_DETECTED");
});

test("controller enforces the persisted model token budget before dispatching a browser action", async () => {
  const values = new Map();
  globalThis.chrome = {
    tabs: { get: async () => ({ id: 4, url: "https://example.com/" }) },
    storage: { local: {
      get: async (key) => typeof key === "string" ? { [key]: values.get(key) } : Object.fromEntries(key.map((item) => [item, values.get(item)])),
      set: async (entries) => { for (const [key, value] of Object.entries(entries)) values.set(key, value); },
    } },
  };
  const repo = new TaskRepository();
  const compiler = new TaskCompiler({ compilePrompt: async () => ({ goal: "Read the page", category: "research", successCriteria: ["The page text is read"], proposedPlan: [{ description: "Read page", expectedTool: "read_page_text" }] }) });
  const observation = { observationId: crypto.randomUUID(), taskId, tabId: 4, url: "https://example.com/", title: "Page", mode: "interactive", capturedAt: new Date().toISOString(), viewport: { width: 800, height: 600, scrollX: 0, scrollY: 0, totalHeight: 600 }, fingerprint: "page", headings: [], landmarks: [], truncated: false, elementCount: 0, elements: [] };
  const observer = { captureSnapshot: async () => ({ ...observation, observationId: crypto.randomUUID() }) };
  let dispatched = 0;
  const pipeline = new ToolValidationPipeline(new ActionQueue(), async () => { dispatched += 1; return {}; }, async () => ({ verified: true }));
  const planner = { proposeNext: async (_task, current) => ({ kind: "tool", usage: { promptTokens: 2, completionTokens: 2, totalTokens: 4 }, envelope: { protocolVersion: 1, taskId, callId: crypto.randomUUID(), tool: "read_page_text", arguments: { observationId: current.observationId, maxChars: 100 }, reason: "Read visible page text", expectedOutcome: "Page text is returned" } }) };
  const controller = new TaskController(repo, compiler, observer, pipeline, new PolicyEngine(), planner);
  await controller.compileTask(taskId, "Read the page", 4);
  const specKey = `atlas_agent_task_${taskId}_spec`;
  const spec = values.get(specKey);
  spec.budgets.maxTokens = 3;
  values.set(specKey, spec);
  await controller.approvePlan(taskId, true);
  await controller.tick(taskId);
  const state = await controller.tick(taskId);
  assert.equal(state.state, "Failed");
  assert.equal(state.error.code, "TOKEN_BUDGET_EXCEEDED");
  assert.equal(state.budgetsUsed.tokens, 4);
  assert.equal(dispatched, 0);
});

test("controller recompiles an ambiguous task after the user clarifies it", async () => {
  const values = new Map();
  globalThis.chrome = {
    tabs: { get: async () => ({ id: 4, url: "https://example.com/" }) },
    storage: { local: {
      get: async (key) => typeof key === "string" ? { [key]: values.get(key) } : Object.fromEntries(key.map((item) => [item, values.get(item)])),
      set: async (entries) => { for (const [key, value] of Object.entries(entries)) values.set(key, value); },
    } },
  };
  let compileCalls = 0;
  const compiler = new TaskCompiler({ compilePrompt: async (prompt) => {
    compileCalls += 1;
    return { goal: "Read regional support details", category: "research", constraints: [], forbiddenOutcomes: [], successCriteria: ["Regional contact is identified"], ambiguities: compileCalls === 1 ? ["Which region should I use?"] : [], proposedPlan: [{ description: "Read support details", expectedTool: "read_page_text" }] };
  } });
  const repo = new TaskRepository();
  const observer = { captureSnapshot: async () => { throw new Error("Observation is not needed for this test."); } };
  const pipeline = new ToolValidationPipeline(new ActionQueue(), async () => ({}), async () => ({ verified: true }));
  const planner = { proposeNext: async () => ({ kind: "clarification", question: "Which region should I use?" }) };
  const controller = new TaskController(repo, compiler, observer, pipeline, new PolicyEngine(), planner);
  let state = await controller.compileTask(taskId, "Find support information", 4);
  assert.equal(state.state, "NeedsUserInput");
  state = await controller.provideClarification(taskId, "Use the India support region");
  assert.equal(state.state, "AwaitingPlanApproval");
  assert.equal(compileCalls, 2);
  assert.match((await repo.getTaskSpec(taskId)).rawUserPrompt, /Use the India support region/);
});

test("controller stops when clarification recompilation exceeds the token budget", async () => {
  const values = new Map();
  globalThis.chrome = {
    tabs: { get: async () => ({ id: 4, url: "https://example.com/" }) },
    storage: { local: {
      get: async (key) => typeof key === "string" ? { [key]: values.get(key) } : Object.fromEntries(key.map((item) => [item, values.get(item)])),
      set: async (entries) => { for (const [key, value] of Object.entries(entries)) values.set(key, value); },
    } },
  };
  let compileCalls = 0;
  const provider = { compilePromptWithUsage: async () => {
    compileCalls += 1;
    return {
      draft: { goal: "Read regional support details", category: "research", successCriteria: ["Regional contact is identified"], ambiguities: compileCalls === 1 ? ["Which region should I use?"] : [], proposedPlan: [{ description: "Read support details", expectedTool: "read_page_text" }] },
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: compileCalls === 1 ? 0 : 50001 },
    };
  } };
  const compiler = new TaskCompiler(provider);
  const repo = new TaskRepository();
  const observer = { captureSnapshot: async () => { throw new Error("Observation is not needed for this test."); } };
  const pipeline = new ToolValidationPipeline(new ActionQueue(), async () => ({}), async () => ({ verified: true }));
  const planner = { proposeNext: async () => ({ kind: "clarification", question: "Which region should I use?" }) };
  const controller = new TaskController(repo, compiler, observer, pipeline, new PolicyEngine(), planner);
  let state = await controller.compileTask(taskId, "Find support information", 4);
  assert.equal(state.state, "NeedsUserInput");
  state = await controller.provideClarification(taskId, "Use the India support region");
  assert.equal(state.state, "Failed");
  assert.equal(state.error.code, "TOKEN_BUDGET_EXCEEDED");
  assert.equal(state.budgetsUsed.tokens, 50001);
});

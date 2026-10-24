import assert from "node:assert/strict";
import { test } from "node:test";
import { OpenRouterPlanner } from "../src/agent/OpenRouterPlanner.ts";

const taskId = "11111111-1111-4111-8111-111111111111";
const task = {
  id: taskId, createdAt: new Date().toISOString(), rawUserPrompt: "Read the page", goal: "Read the support information", category: "research",
  constraints: [], forbiddenOutcomes: ["Do not submit forms"], successCriteria: ["Support email appears"], allowedOrigins: ["https://example.com"],
  allowedTools: ["read_page_text", "finish_task"], dataExposure: { containsPII: true, discloseToProvider: false, sensitiveFieldTypes: ["email"] }, ambiguities: [],
  proposedPlan: [{ stepNumber: 1, description: "Read page text", expectedTool: "read_page_text", requiresApproval: false }],
  budgets: { maxSteps: 30, deadlineMs: 600000, maxTokens: 50000, maxTabs: 1, retryBudgetPerStep: 2 },
};
const observation = {
  observationId: "22222222-2222-4222-8222-222222222222", taskId, tabId: 7, url: "https://example.com/help", title: "Help", mode: "interactive", capturedAt: new Date().toISOString(),
  viewport: { width: 1000, height: 800, scrollX: 0, scrollY: 0, totalHeight: 800 }, fingerprint: "fingerprint", headings: [], landmarks: [], truncated: false, elementCount: 1,
  elements: [{ id: "el_1", tagName: "input", role: "textbox", name: "Email", value: "private@example.com", disabled: false, readOnly: false, visible: true, inViewport: true, bounds: { x: 0, y: 0, width: 100, height: 20, top: 0, left: 0 } }],
};

test("planner validates one tool proposal and omits field values when provider disclosure is disabled", async () => {
  let request;
  const planner = new OpenRouterPlanner({ proposeNext: async (value) => {
    request = value;
    return { rawContent: JSON.stringify({ kind: "tool", tool: "read_page_text", arguments: { maxTokens: 100 }, reason: "Read the visible support page", expectedOutcome: "Support details are available" }), usage: { promptTokens: 20, completionTokens: 5, totalTokens: 25 }, latencyMs: 7 };
  } });
  const result = await planner.proposeNext(task, observation);
  assert.equal(result.kind, "tool");
  assert.equal(result.envelope.taskId, taskId);
  assert.equal(result.envelope.tool, "read_page_text");
  assert.equal(result.usage.totalTokens, 25);
  assert.doesNotMatch(request.promptOverride, /private@example\.com/);
});

test("planner maps user-input and finish tool proposals to controller states", async () => {
  const outputs = [
    { rawContent: JSON.stringify({ kind: "tool", tool: "request_user_input", arguments: { question: "Which region should I search?" } }), latencyMs: 1 },
    { rawContent: JSON.stringify({ kind: "tool", tool: "finish_task", arguments: { summary: "The support email is shown on the page.", evidenceRefs: ["heading:Contact"] } }), latencyMs: 1 },
  ];
  const planner = new OpenRouterPlanner({ proposeNext: async () => outputs.shift() });
  assert.deepEqual(await planner.proposeNext(task, observation), { kind: "clarification", question: "Which region should I search?" });
  assert.deepEqual(await planner.proposeNext(task, observation), { kind: "finish", summary: "The support email is shown on the page.", evidenceRefs: ["heading:Contact"] });
});

test("planner fails closed when OpenRouter returns malformed task-step JSON", async () => {
  const planner = new OpenRouterPlanner({ proposeNext: async () => ({ rawContent: "not json", latencyMs: 1 }) });
  await assert.rejects(planner.proposeNext(task, observation), /malformed task step/);
});

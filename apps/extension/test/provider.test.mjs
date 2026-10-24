import assert from "node:assert/strict";
import { test } from "node:test";
import { OpenRouterProvider } from "../src/agent/provider.ts";

test("OpenRouter tool requests go directly to the provider and normalize structured calls and usage", async () => {
  let request;
  const provider = new OpenRouterProvider(async () => "sk-or-v1-test-key", async () => "test/model", async (url, init) => {
    request = { url: String(url), init };
    return Response.json({ choices: [{ message: { tool_calls: [{ function: { name: "read_page_text", arguments: "{\"maxChars\":200}" } }] } }], usage: { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15, cost: 0.001 } });
  });
  const result = await provider.proposeNext({
    systemPolicy: "Only use bounded tools.",
    taskSpec: { id: "11111111-1111-4111-8111-111111111111", goal: "Read the page", constraints: [], successCriteria: [] },
    toolSchemas: [{ name: "read_page_text", description: "Read visible page text", parameters: { type: "object" } }],
  });
  assert.equal(request.url, "https://openrouter.ai/api/v1/chat/completions");
  assert.equal(request.init.headers.Authorization, "Bearer sk-or-v1-test-key");
  assert.equal(JSON.parse(request.init.body).model, "test/model");
  assert.equal(JSON.parse(request.init.body).stream, true);
  assert.equal(result.proposedCall.tool, "read_page_text");
  assert.equal(result.proposedCall.arguments.maxChars, 200);
  assert.equal(result.usage.totalTokens, 15);
});

test("OpenRouter SSE stream reassembles split tool arguments and token usage", async () => {
  const chunks = [
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"read_page_text","arguments":"{\\\"max"}}]}}]}\n\n',
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"Chars\\\":200}"}}]}}],"usage":{"prompt_tokens":9,"completion_tokens":2,"total_tokens":11}}\n\n',
    "data: [DONE]\n\n",
  ];
  const stream = new ReadableStream({ start(controller) { for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk)); controller.close(); } });
  const provider = new OpenRouterProvider(async () => "sk-or-v1-test-key", async () => "test/model", async () => new Response(stream, { headers: { "content-type": "text/event-stream" } }));
  const result = await provider.proposeNext({ systemPolicy: "policy", taskSpec: { id: "11111111-1111-4111-8111-111111111111" } });
  assert.equal(result.proposedCall.tool, "read_page_text");
  assert.equal(result.proposedCall.arguments.maxChars, 200);
  assert.equal(result.usage.totalTokens, 11);
});

test("connection test retries rate limits with bounded backoff and reports safe diagnostics", async () => {
  let attempts = 0;
  const delays = [];
  const provider = new OpenRouterProvider(async () => null, async () => "test/model", async (_url, init) => {
    attempts += 1;
    assert.equal(JSON.parse(init.body).max_tokens, 1);
    if (attempts === 1) return new Response("", { status: 429 });
    return Response.json({ choices: [{ message: { content: "pong" } }] });
  }, async (delay) => delays.push(delay), () => 0.5);
  const result = await provider.testConnection("sk-or-v1-test-secret", "test/model");
  assert.deepEqual(result.success, true);
  assert.equal(attempts, 2);
  assert.deepEqual(delays, [625]);
});

test("OpenRouter retries service unavailable before returning one proposal", async () => {
  let attempts = 0;
  const delays = [];
  const provider = new OpenRouterProvider(async () => "sk-or-v1-test-key", async () => "test/model", async () => {
    attempts += 1;
    if (attempts === 1) return new Response("", { status: 503 });
    return Response.json({ choices: [{ message: { tool_calls: [{ function: { name: "read_page_text", arguments: "{}" } }] } }] });
  }, async (delay) => delays.push(delay), () => 0.5);
  const result = await provider.proposeNext({ systemPolicy: "policy", taskSpec: { id: "11111111-1111-4111-8111-111111111111" } });
  assert.equal(result.proposedCall.tool, "read_page_text");
  assert.equal(attempts, 2);
  assert.deepEqual(delays, [625]);
});

test("provider errors never include response bodies or the API key", async () => {
  const provider = new OpenRouterProvider(async () => null, async () => "test/model", async () => new Response(
    JSON.stringify({ error: { message: "Rejected Bearer sk-or-v1-super-secret-token" } }), { status: 401 },
  ));
  const result = await provider.testConnection("sk-or-v1-super-secret-token", "test/model");
  assert.equal(result.success, false);
  assert.match(result.error, /AUTHENTICATION_ERROR/);
  assert.doesNotMatch(result.error, /super-secret-token/);
});

test("provider rejects malformed tool arguments without retrying or dispatching a tool", async () => {
  let attempts = 0;
  const provider = new OpenRouterProvider(async () => "sk-or-v1-test-key", async () => "test/model", async () => {
    attempts += 1;
    return Response.json({ choices: [{ message: { tool_calls: [{ function: { name: "click_element", arguments: "not-json" } }] } }] });
  });
  await assert.rejects(provider.proposeNext({ systemPolicy: "policy", taskSpec: { id: "11111111-1111-4111-8111-111111111111" } }), /malformed tool arguments/);
  assert.equal(attempts, 1);
});

test("task compilation returns provider token usage for the persistent task budget", async () => {
  const provider = new OpenRouterProvider(async () => "sk-or-v1-test-key", async () => "test/model", async (_url, init) => {
    const body = JSON.parse(init.body);
    assert.equal(body.max_tokens, 2000);
    return Response.json({ choices: [{ message: { content: JSON.stringify({ goal: "Read support information", category: "research", constraints: [], forbiddenOutcomes: [], successCriteria: ["Email is shown"], ambiguities: [], proposedPlan: [{ description: "Read page text", expectedTool: "read_page_text" }], containsPII: false, sensitiveFieldTypes: [] }) } }], usage: { prompt_tokens: 40, completion_tokens: 20, total_tokens: 60, cost: 0.002 } });
  });
  const result = await provider.compilePromptWithUsage("Read support information", "https://example.com/help");
  assert.equal(result.usage.totalTokens, 60);
  assert.equal(result.usage.estimatedCostUsd, 0.002);
  assert.equal(result.draft.goal, "Read support information");
});

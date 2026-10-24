import { ToolEnvelopeSchema, type ToolEnvelope } from "../tools/protocol.ts";
import type { PageObservation } from "../perception/types.ts";
import type { TaskSpec } from "./types.ts";

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCostUsd?: number;
}

export interface ModelRequest {
  systemPolicy: string;
  taskSpec?: TaskSpec;
  observation?: PageObservation;
  toolSchemas?: Array<{ name: string; description: string; parameters: Record<string, unknown> }>;
  promptOverride?: string;
  maxTokens?: number;
}

export interface ModelResponse {
  proposedCall?: ToolEnvelope;
  needInput?: { question: string; options?: string[] };
  finish?: { summary: string; evidenceRefs: string[] };
  usage?: TokenUsage;
  rawContent?: string;
  latencyMs: number;
}

export interface ModelProvider {
  proposeNext(request: ModelRequest, signal?: AbortSignal): Promise<ModelResponse>;
  compilePrompt(prompt: string, activeTabUrl?: string, signal?: AbortSignal): Promise<unknown>;
  compilePromptWithUsage(prompt: string, activeTabUrl?: string, signal?: AbortSignal): Promise<{ draft: unknown; usage?: TokenUsage }>;
  testConnection(apiKey: string, modelId: string, signal?: AbortSignal): Promise<{ success: boolean; latencyMs: number; error?: string }>;
}

export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type StreamToolCall = { index?: number; id?: string; type?: string; function?: { name?: string; arguments?: string } };
type StreamChunk = { choices?: Array<{ delta?: { content?: unknown; tool_calls?: StreamToolCall[] } }>; usage?: unknown };
const API_URL = "https://openrouter.ai/api/v1/chat/completions";
const MAX_RETRIES = 2;

/** Direct OpenRouter BYOK adapter. It never routes requests through the companion backend. */
export class OpenRouterProvider implements ModelProvider {
  private readonly getApiKey: () => Promise<string | null>;
  private readonly getModelId: () => Promise<string>;
  private readonly fetcher: FetchLike;
  private readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  private readonly random: () => number;

  constructor(
    getApiKey: () => Promise<string | null>,
    getModelId: () => Promise<string>,
    fetcher: FetchLike = fetch,
    sleep: (ms: number, signal?: AbortSignal) => Promise<void> = abortableSleep,
    random: () => number = Math.random,
  ) {
    this.getApiKey = getApiKey;
    this.getModelId = getModelId;
    this.fetcher = fetcher;
    this.sleep = sleep;
    this.random = random;
  }

  async proposeNext(request: ModelRequest, signal?: AbortSignal): Promise<ModelResponse> {
    const apiKey = await this.getApiKey();
    if (!apiKey) throw new Error("AUTHENTICATION_REQUIRED: Configure an OpenRouter API key in Settings.");
    const model = await this.getModelId();
    const started = performance.now();
    const body = {
      model,
      messages: formatMessages(request),
      tools: request.toolSchemas?.length ? request.toolSchemas.map((item) => ({
        type: "function", function: { name: item.name, description: item.description, parameters: item.parameters },
      })) : undefined,
      tool_choice: request.toolSchemas?.length ? "auto" : undefined,
      temperature: 0.1,
      max_tokens: Math.max(1, Math.min(4000, Math.floor(request.maxTokens ?? 1500))),
      stream: true,
    };
    const response = await this.request(apiKey, body, signal);
    if (!response.ok) throw await normalizedHttpError(response);
    let json: unknown;
    try { json = response.headers.get("content-type")?.includes("text/event-stream") ? await readEventStream(response) : await response.json(); }
    catch (error) {
      if (signal?.aborted) throw new Error("REQUEST_CANCELLED: Provider request was cancelled.");
      if (error instanceof Error && error.message.startsWith("PROVIDER_")) throw error;
      throw new Error("PROVIDER_INVALID_RESPONSE: OpenRouter returned unreadable data.");
    }
    return parseResponse(json, request.taskSpec?.id, Math.round(performance.now() - started));
  }

  async compilePrompt(prompt: string, activeTabUrl?: string, signal?: AbortSignal): Promise<unknown> {
    return (await this.compilePromptWithUsage(prompt, activeTabUrl, signal)).draft;
  }

  async compilePromptWithUsage(prompt: string, activeTabUrl?: string, signal?: AbortSignal): Promise<{ draft: unknown; usage?: TokenUsage }> {
    const response = await this.proposeNext({
      systemPolicy: "Compile a browser task into JSON. Return only a JSON object with goal, category, constraints, forbiddenOutcomes, successCriteria, ambiguities, proposedPlan (description, expectedTool, targetDomain?, requiresApproval), containsPII, and sensitiveFieldTypes. Never invent tools outside the provided task requirements.",
      promptOverride: `User request:\n${prompt}\nActive tab URL:\n${activeTabUrl ?? "none"}\nReturn only the requested JSON object.`,
      maxTokens: 2000,
    }, signal);
    if (!response.rawContent) throw new Error("PROVIDER_INVALID_PLAN: OpenRouter did not return a task plan.");
    try { return { draft: JSON.parse(stripJsonFence(response.rawContent)), ...(response.usage ? { usage: response.usage } : {}) }; }
    catch { throw new Error("PROVIDER_INVALID_PLAN: OpenRouter returned malformed task plan JSON."); }
  }

  async testConnection(apiKey: string, modelId: string, signal?: AbortSignal): Promise<{ success: boolean; latencyMs: number; error?: string }> {
    const key = apiKey.trim();
    const model = modelId.trim();
    if (!key || key.length > 500 || !model || model.length > 200) {
      return { success: false, latencyMs: 0, error: "Enter a valid API key and model ID." };
    }
    const started = performance.now();
    try {
      const response = await this.request(key, { model, messages: [{ role: "user", content: "ping" }], max_tokens: 1, stream: false }, signal);
      if (!response.ok) throw await normalizedHttpError(response);
      return { success: true, latencyMs: Math.round(performance.now() - started) };
    } catch (error) {
      return { success: false, latencyMs: Math.round(performance.now() - started), error: safeError(error) };
    }
  }

  private async request(apiKey: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<Response> {
    let attempt = 0;
    while (true) {
      if (signal?.aborted) throw new Error("REQUEST_CANCELLED: Provider request was cancelled.");
      let response: Response;
      try {
        response = await this.fetcher(API_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            "HTTP-Referer": "https://github.com/kaiju-no-9/Atlas",
            "X-Title": "Atlas Browser Agent",
          },
          body: JSON.stringify(body),
          signal,
        });
      } catch (error) {
        if (signal?.aborted || (error instanceof Error && error.name === "AbortError")) throw new Error("REQUEST_CANCELLED: Provider request was cancelled.");
        if (attempt >= MAX_RETRIES) throw new Error("NETWORK_ERROR: Could not reach OpenRouter after bounded retries.");
        await this.sleep(retryDelay(attempt, this.random), signal);
        attempt += 1;
        continue;
      }
      if (![429, 500, 502, 503, 504].includes(response.status) || attempt >= MAX_RETRIES) return response;
      await response.body?.cancel().catch(() => undefined);
      await this.sleep(retryDelay(attempt, this.random), signal);
      attempt += 1;
    }
  }
}

function retryDelay(attempt: number, random: () => number): number {
  const jitter = Math.floor(Math.max(0, Math.min(0.999, random())) * 250);
  return Math.min(4000, 500 * 2 ** attempt + jitter);
}

async function normalizedHttpError(response: Response): Promise<Error> {
  const status = response.status;
  if (status === 401 || status === 403) return new Error("AUTHENTICATION_ERROR: OpenRouter rejected the API key or account.");
  if (status === 429) return new Error("RATE_LIMIT_EXCEEDED: OpenRouter rate limit or credit limit reached.");
  if (status === 503 || status >= 500) return new Error(`PROVIDER_UNAVAILABLE: OpenRouter returned HTTP ${status}.`);
  return new Error(`PROVIDER_ERROR: OpenRouter returned HTTP ${status}.`);
}

function formatMessages(request: ModelRequest): Array<{ role: "system" | "user"; content: string }> {
  if (request.promptOverride !== undefined) return [
    { role: "system", content: request.systemPolicy }, { role: "user", content: request.promptOverride },
  ];
  const observation = request.observation;
  const summary = observation ? {
    url: observation.url, title: observation.title,
    elements: observation.elements.slice(0, 200).map(({ id, role, name, value, inViewport }) => ({ id, role, name, value, inViewport })),
  } : null;
  return [
    { role: "system", content: request.systemPolicy },
    { role: "user", content: `Goal: ${request.taskSpec?.goal ?? ""}\nConstraints: ${request.taskSpec?.constraints?.join("; ") ?? ""}\nSuccess criteria: ${request.taskSpec?.successCriteria?.join("; ") ?? ""}\nPage observation: ${JSON.stringify(summary)}\nReturn one bounded next step.` },
  ];
}

function parseResponse(raw: unknown, taskId: string | undefined, latencyMs: number): ModelResponse {
  if (!raw || typeof raw !== "object") throw new Error("PROVIDER_INVALID_RESPONSE: OpenRouter returned an unexpected response.");
  const response = raw as { choices?: Array<{ message?: { content?: unknown; tool_calls?: Array<{ function?: { name?: unknown; arguments?: unknown } }> } }>; usage?: { prompt_tokens?: unknown; completion_tokens?: unknown; total_tokens?: unknown; cost?: unknown } };
  const message = response.choices?.[0]?.message;
  if (!message) throw new Error("PROVIDER_EMPTY_RESPONSE: OpenRouter returned no model response.");
  const usage: TokenUsage | undefined = response.usage ? {
    promptTokens: numberOrZero(response.usage.prompt_tokens),
    completionTokens: numberOrZero(response.usage.completion_tokens),
    totalTokens: numberOrZero(response.usage.total_tokens),
    ...(typeof response.usage.cost === "number" && Number.isFinite(response.usage.cost) ? { estimatedCostUsd: response.usage.cost } : {}),
  } : undefined;
  const call = message.tool_calls?.[0];
  if (call) {
    if (typeof call.function?.name !== "string" || typeof call.function.arguments !== "string" || !taskId) {
      throw new Error("PROVIDER_INVALID_TOOL_CALL: OpenRouter returned an incomplete tool call.");
    }
    let args: unknown;
    try { args = JSON.parse(call.function.arguments); } catch { throw new Error("PROVIDER_INVALID_TOOL_CALL: OpenRouter returned malformed tool arguments."); }
    if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error("PROVIDER_INVALID_TOOL_CALL: Tool arguments must be an object.");
    return {
      proposedCall: ToolEnvelopeSchema.parse({ protocolVersion: 1, taskId, callId: crypto.randomUUID(), tool: call.function.name,
        arguments: args, reason: "Advance the user-approved task plan", expectedOutcome: "The requested browser state is observed" }),
      ...(usage ? { usage } : {}), latencyMs,
    };
  }
  if (typeof message.content !== "string" || !message.content.trim()) throw new Error("PROVIDER_EMPTY_RESPONSE: OpenRouter returned no content.");
  let structured: unknown;
  try { structured = JSON.parse(message.content); } catch { return { rawContent: message.content, ...(usage ? { usage } : {}), latencyMs }; }
  if (structured && typeof structured === "object") {
    const value = structured as { needInput?: unknown; finish?: unknown };
    if (value.needInput && typeof value.needInput === "object" && typeof (value.needInput as { question?: unknown }).question === "string") {
      return { needInput: value.needInput as ModelResponse["needInput"], ...(usage ? { usage } : {}), latencyMs };
    }
    if (value.finish && typeof value.finish === "object" && typeof (value.finish as { summary?: unknown }).summary === "string") {
      return { finish: value.finish as ModelResponse["finish"], ...(usage ? { usage } : {}), latencyMs };
    }
  }
  return { rawContent: message.content, ...(usage ? { usage } : {}), latencyMs };
}

function numberOrZero(value: unknown): number { return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0; }
function stripJsonFence(value: string): string { return value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""); }

async function readEventStream(response: Response): Promise<unknown> {
  if (!response.body) throw new Error("PROVIDER_INVALID_RESPONSE: OpenRouter returned an empty stream.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let usage: unknown;
  const calls = new Map<number, { id?: string; type?: string; function: { name: string; arguments: string } }>();
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      if (done) buffer += "\n";
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (!data || data === "[DONE]") continue;
        let chunk: StreamChunk;
        try { chunk = JSON.parse(data); } catch { continue; }
        usage = chunk.usage ?? usage;
        const delta = chunk.choices?.[0]?.delta;
        if (typeof delta?.content === "string") content += delta.content;
        for (const item of delta?.tool_calls ?? []) {
          const index = Number.isInteger(item.index) ? item.index! : 0;
          const previous = calls.get(index) ?? { function: { name: "", arguments: "" } };
          if (typeof item.id === "string") previous.id = item.id;
          if (typeof item.type === "string") previous.type = item.type;
          if (typeof item.function?.name === "string") previous.function.name += item.function.name;
          if (typeof item.function?.arguments === "string") previous.function.arguments += item.function.arguments;
          calls.set(index, previous);
        }
      }
      if (done) break;
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
  return { choices: [{ message: { content: content || null, ...(calls.size ? { tool_calls: [...calls.entries()].sort(([a], [b]) => a - b).map(([, call]) => call) } : {}) } }], ...(usage ? { usage } : {}) };
}

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : "Provider connection failed.";
  return message.replace(/(?:sk-[A-Za-z0-9_-]{12,}|Bearer\s+\S+)/gi, "[REDACTED]").slice(0, 300);
}
function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new Error("REQUEST_CANCELLED")); return; }
    const timer = setTimeout(() => { signal?.removeEventListener("abort", abort); resolve(); }, ms);
    const abort = () => { clearTimeout(timer); reject(new Error("REQUEST_CANCELLED")); };
    signal?.addEventListener("abort", abort, { once: true });
  });
}

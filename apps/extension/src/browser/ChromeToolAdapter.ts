import { ScriptInjector } from "./ScriptInjector.ts";
import type { ToolEnvelope } from "../tools/protocol.ts";
import type { ToolName } from "../tools/registry.ts";
import { ActionQueue } from "./actionQueue.ts";
import { ToolValidationPipeline, type PipelineContext } from "../tools/pipeline.ts";

export interface ToolGates {
  requestUserInput?: (taskId: string, question: string, options?: string[]) => Promise<string>;
  requestApproval?: (taskId: string, summary: string, target: string, consequence: string) => Promise<{ approved: boolean; approvalToken?: string }>;
  finishTask?: (taskId: string, summary: string, evidenceRefs: string[]) => Promise<boolean>;
}

/** Narrow adapter for Chrome APIs and the isolated, schema-checked content actions. */
export class ChromeToolAdapter {
  private readonly injector: ScriptInjector;
  private readonly gates: ToolGates;
  private readonly taskTabLocks = new Map<string, Promise<void>>();

  constructor(injector = new ScriptInjector(), gates: ToolGates = {}) { this.injector = injector; this.gates = gates; }

  async execute(tabId: number, tool: ToolName, args: unknown, envelope: ToolEnvelope): Promise<unknown> {
    const parsed = await chrome.tabs.get(tabId);
    const currentUrl = parsed.url ?? "";
    if (!isWebUrl(currentUrl)) throw toolError("POLICY_VIOLATION", "Chrome internal and non-web pages are unavailable to browser tools.");
    const record = args as Record<string, unknown>;
    switch (tool) {
      case "get_current_tab":
        return { id: parsed.id ?? tabId, url: currentUrl, title: parsed.title ?? "", status: parsed.status ?? "complete", windowId: parsed.windowId };
      case "observe_page":
        return this.injector.observePage(tabId, envelope.taskId, record.mode as "compact" | "interactive" | "full_limited" | undefined);
      case "read_page_text": {
        const text = await this.injector.readVisibleText(tabId);
        const limit = Number(record.maxTokens ?? 2000) * 4;
        return { text: text.slice(0, limit), truncated: text.length > limit };
      }
      case "click_element": case "type_text": case "select_option": case "press_key": case "scroll_page":
        return this.executeInPage(tabId, tool, record, envelope);
      case "navigate": {
        const url = String(record.url);
        await chrome.tabs.update(tabId, { url });
        return { navigatedTo: url };
      }
      case "go_back": case "go_forward": {
        if (tool === "go_back") await chrome.tabs.goBack(tabId); else await chrome.tabs.goForward(tabId);
        const destination = await chrome.tabs.get(tabId);
        if (!destination.url || !isWebUrl(destination.url)) throw toolError("POLICY_VIOLATION", "Navigation reached a protected browser page.");
        return { destinationUrl: destination.url };
      }
      case "open_tab": {
        return this.openTaskTab(envelope.taskId, String(record.url));
      }
      case "wait_for_state":
        return this.waitForState(tabId, record);
      case "capture_screenshot":
        throw toolError("POLICY_VIOLATION", "Screenshot capture is disabled until the privacy and redaction controls are available.");
      case "request_user_input": {
        if (!this.gates.requestUserInput) throw toolError("USER_INPUT_UNAVAILABLE", "The task has no connected user input gate.");
        return { answer: await this.gates.requestUserInput(envelope.taskId, String(record.question), record.options as string[] | undefined) };
      }
      case "request_approval": {
        if (!this.gates.requestApproval) throw toolError("APPROVAL_GATE_UNAVAILABLE", "The task has no connected approval gate.");
        return this.gates.requestApproval(envelope.taskId, String(record.summary), String(record.target), String(record.consequence));
      }
      case "finish_task": {
        if (!this.gates.finishTask) throw toolError("TASK_CONTROLLER_UNAVAILABLE", "The task controller cannot yet verify completion.");
        return { completed: await this.gates.finishTask(envelope.taskId, String(record.summary), record.evidenceRefs as string[]) };
      }
    }
  }

  /** Re-observes mutations and only records success when the concrete expected state is visible. */
  async verifyOutcome(tool: ToolName, args: unknown, output: unknown, context: PipelineContext): Promise<{ verified: boolean; observationId?: string }> {
    const record = args as Record<string, unknown>;
    const result = output as Record<string, unknown>;
    if (tool === "finish_task") return { verified: result.completed === true };
    if (!this.mutatesPage(tool)) return { verified: true };
    if (tool === "navigate" || tool === "go_back" || tool === "go_forward") {
      const tab = await chrome.tabs.get(context.tabId);
      const expectedUrl = tool === "navigate" ? record.url : result.destinationUrl;
      return { verified: typeof tab.url === "string" && tab.url === expectedUrl && this.isAllowedOrigin(tab.url, context) };
    }
    if (tool === "open_tab") {
      const tabId = result.tabId;
      if (typeof tabId !== "number") return { verified: false };
      const tab = await chrome.tabs.get(tabId);
      return { verified: typeof tab.url === "string" && tab.url === result.url && this.isAllowedOrigin(tab.url, context) };
    }

    const after = await this.injector.observePage(context.tabId, context.taskId, "interactive") as { observationId?: string; url?: string; fingerprint?: string; viewport?: { scrollY?: number }; elements?: Array<Record<string, unknown>> };
    if (!after.observationId || typeof after.url !== "string" || !this.isAllowedOrigin(after.url, context)) return { verified: false };
    const before = context.activeObservation as { fingerprint?: string; viewport?: { scrollY?: number }; elements?: Array<Record<string, unknown>> } | undefined;
    if (!before) return { verified: false, observationId: after.observationId };

    if (tool === "scroll_page") {
      const movedTo = result.currentScrollY;
      const oldY = before.viewport?.scrollY;
      const newY = after.viewport?.scrollY;
      const direction = record.direction;
      const movedInDirection = typeof oldY === "number" && typeof newY === "number" && (direction === "down" || direction === "bottom" ? newY > oldY : direction === "up" || direction === "top" ? newY < oldY : false);
      return { verified: typeof movedTo === "number" && newY === movedTo && movedInDirection, observationId: after.observationId };
    }

    if (tool === "click_element" || tool === "press_key") {
      return { verified: Boolean(before.fingerprint && after.fingerprint && before.fingerprint !== after.fingerprint), observationId: after.observationId };
    }

    if (tool === "type_text" || tool === "select_option") {
      const elementId = record.elementId;
      const previous = before.elements?.find((item) => item.id === elementId);
      if (!previous) return { verified: false, observationId: after.observationId };
      const matches = after.elements?.filter((item) => item.tagName === previous.tagName && item.role === previous.role && item.name === previous.name && item.placeholder === previous.placeholder) ?? [];
      if (matches.length !== 1 || !matches[0]) return { verified: false, observationId: after.observationId };
      const current = matches[0];
      if (tool === "type_text") {
        const text = record.text;
        if (typeof text !== "string") return { verified: false, observationId: after.observationId };
        const expected = record.clearBefore === true ? text : `${String(previous.value ?? "")}${text}`;
        return { verified: current.value === expected && result.typedLength === text.length, observationId: after.observationId };
      }
      return { verified: current.value === record.value && result.selectedValue === record.value, observationId: after.observationId };
    }
    return { verified: false };
  }

  private isAllowedOrigin(url: string, context: PipelineContext): boolean {
    try { return context.allowedOrigins.has(new URL(url).origin); } catch { return false; }
  }

  private mutatesPage(tool: ToolName): boolean {
    return ["click_element", "type_text", "select_option", "press_key", "scroll_page", "navigate", "go_back", "go_forward", "open_tab"].includes(tool);
  }

  createPipeline(): ToolValidationPipeline {
    return new ToolValidationPipeline(
      new ActionQueue(),
      (tabId, tool, args, envelope) => this.execute(tabId, tool, args, envelope),
      (tool, args, output, context) => this.verifyOutcome(tool, args, output, context),
    );
  }

  private async executeInPage(tabId: number, tool: ToolName, args: Record<string, unknown>, envelope: ToolEnvelope): Promise<unknown> {
    const result = await this.injector.sendContentAction(tabId, {
      type: "EXECUTE_TOOL",
      payload: {
        protocolVersion: 1, taskId: envelope.taskId, callId: envelope.callId,
        tool, arguments: args, reason: envelope.reason, expectedOutcome: envelope.expectedOutcome,
      },
    });
    return result;
  }

  private async waitForState(tabId: number, args: Record<string, unknown>): Promise<{ satisfied: boolean; elapsedMs: number }> {
    const result = await this.injector.sendContentAction(tabId, {
      type: "WAIT_FOR_STATE",
      condition: args.condition as "element_present" | "element_gone" | "url_changed" | "dom_quiescent",
      observationId: args.observationId as string | undefined,
      elementId: args.elementId as string | undefined,
      fromUrl: args.fromUrl as string | undefined,
      timeoutMs: Number(args.timeoutMs ?? 3000),
    });
    return { satisfied: result.satisfied === true, elapsedMs: typeof result.elapsedMs === "number" ? result.elapsedMs : 0 };
  }

  private async openTaskTab(taskId: string, url: string): Promise<{ tabId: number; url: string }> {
    const previous = this.taskTabLocks.get(taskId) ?? Promise.resolve();
    let release!: () => void;
    const tail = previous.then(() => new Promise<void>((resolve) => { release = resolve; }));
    this.taskTabLocks.set(taskId, tail);
    await previous;
    try {
      const key = `atlas_tool_tabs_${taskId}`;
      const stored = await chrome.storage.session.get(key);
      const rawIds: unknown = stored[key];
      const ids = Array.isArray(rawIds) ? rawIds.filter((id): id is number => Number.isInteger(id) && id >= 0) : [];
      const activeIds: number[] = [];
      for (const id of ids) {
        try { await chrome.tabs.get(id); activeIds.push(id); } catch { /* remove closed or unavailable tabs from the budget */ }
      }
      if (activeIds.length >= 5) throw toolError("TAB_BUDGET_EXCEEDED", "This task has reached its five-tab limit.");
      const created = await chrome.tabs.create({ url, active: false });
      if (created.id === undefined) throw toolError("TAB_CREATE_FAILED", "Chrome did not return the new tab ID.");
      activeIds.push(created.id);
      await chrome.storage.session.set({ [key]: activeIds });
      return { tabId: created.id, url: created.url ?? url };
    } finally {
      release();
      if (this.taskTabLocks.get(taskId) === tail) this.taskTabLocks.delete(taskId);
    }
  }
}

function isWebUrl(value: string): boolean {
  try { const url = new URL(value); return url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)); }
  catch { return false; }
}
function toolError(code: string, message: string): Error & { code: string; retryable: boolean } {
  return Object.assign(new Error(message), { code, retryable: false });
}

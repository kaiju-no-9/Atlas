import {
  ContentActionResponseSchema,
  ContentActionSchema,
  type ContentAction,
} from "../../../../packages/contracts/src/messages.ts";
import { runContentAction } from "../perception/contentActions.ts";
import { parseToolArguments } from "../tools/registry.ts";

export class ScriptInjector {
  async sendContentAction(tabId: number, rawAction: unknown): Promise<Record<string, unknown>> {
    const action = ContentActionSchema.parse(rawAction);
    const validatedAction = action.type === "OBSERVE_DOM" && action.tabId === undefined
      ? { ...action, tabId }
      : action.type === "EXECUTE_TOOL"
        ? { ...action, payload: { ...action.payload, arguments: parseToolArguments(action.payload.tool, action.payload.arguments).args as Record<string, unknown> } }
        : action;
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId },
      world: "ISOLATED",
      func: runContentAction,
      args: [validatedAction],
    });
    const response = ContentActionResponseSchema.parse(injection?.result);
    if (!response.success) throw new Error(response.error);
    return response.payload;
  }

  async readVisibleText(tabId: number): Promise<string> {
    const observation = await this.sendContentAction(tabId, { type: "OBSERVE_DOM", tabId } satisfies ContentAction);
    return typeof observation.text === "string" ? observation.text : "";
  }

  async observePage(tabId: number, taskId: string, mode: "compact" | "interactive" | "full_limited" = "interactive") {
    const result = await this.sendContentAction(tabId, { type: "OBSERVE_DOM", taskId, tabId, mode } satisfies ContentAction);
    return result.observation;
  }
}

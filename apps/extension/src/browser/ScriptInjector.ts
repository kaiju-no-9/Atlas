import {
  ContentActionResponseSchema,
  ContentActionSchema,
  type ContentAction,
} from "../../../../packages/contracts/src/messages.ts";
import { runContentAction } from "../perception/contentActions.ts";

export class ScriptInjector {
  async sendContentAction(tabId: number, rawAction: unknown): Promise<Record<string, unknown>> {
    const action = ContentActionSchema.parse(rawAction);
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId },
      world: "ISOLATED",
      func: runContentAction,
      args: [action],
    });
    const response = ContentActionResponseSchema.parse(injection?.result);
    if (!response.success) throw new Error(response.error);
    return response.payload;
  }

  async readVisibleText(tabId: number): Promise<string> {
    const observation = await this.sendContentAction(tabId, { type: "OBSERVE_DOM" } satisfies ContentAction);
    return typeof observation.text === "string" ? observation.text : "";
  }
}

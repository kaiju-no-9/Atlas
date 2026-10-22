import { observePageText } from "../perception/observePageText";

export class ScriptInjector {
  async readVisibleText(tabId: number): Promise<string> {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      world: "ISOLATED",
      func: observePageText,
    });
    return typeof result?.result === "string" ? result.result : "";
  }
}

import type { ContentAction, ContentActionResponse } from "../../../../packages/contracts/src/messages.ts";

/**
 * This function is serialized into Chrome's isolated world by ScriptInjector.
 * Keep it self-contained: the page receives only a validated action and gets
 * no extension storage, runtime, or network access.
 */
export function runContentAction(action: ContentAction): ContentActionResponse {
  switch (action.type) {
    case "PING":
      return { success: true, payload: { ready: true, url: window.location.href } };
    case "OBSERVE_DOM":
      return {
        success: true,
        payload: {
          url: window.location.href,
          title: document.title,
          elementCount: document.querySelectorAll("*").length,
          text: (document.body?.innerText ?? "").slice(0, 5000),
        },
      };
    case "EXECUTE_TOOL":
      return { success: false, error: "Tool execution is not available in this phase." };
  }
}

import type { PageObservation, ObservedElement } from "../perception/types.ts";
import type { ToolEnvelope } from "../tools/protocol.ts";

export interface StepVerification {
  progressMade: boolean;
  criteriaSatisfied: boolean;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  details: string;
}

/** Deterministic checks for tool-level state changes; task completion may use a provider separately. */
export class OutcomeVerifier {
  verifyStep(envelope: ToolEnvelope, before: PageObservation, after: PageObservation): StepVerification {
    const args = envelope.arguments;
    if (envelope.tool === "navigate") {
      const expected = typeof args.url === "string" ? canonicalUrl(args.url) : null;
      const actual = canonicalUrl(after.url);
      const success = expected !== null && actual === expected;
      return result(success, success, "HIGH", success ? "Navigation reached the requested URL." : "Navigation did not reach the requested URL.");
    }

    if (envelope.tool === "type_text" || envelope.tool === "select_option") {
      const previous = before.elements.find((element) => element.id === args.elementId);
      if (!previous) return result(false, false, "HIGH", "The target was not present in the before observation.");
      const current = findSameElement(previous, after.elements);
      if (!current) return result(false, false, "HIGH", "The target could not be identified uniquely after the action.");
      if (envelope.tool === "type_text") {
        const text = typeof args.text === "string" ? args.text : "";
        const expected = args.clearBefore === true ? text : `${previous.value ?? ""}${text}`;
        const success = current.value === expected;
        return result(success, success, "HIGH", success ? "The observed field value matches the requested value." : "The observed field value does not match the requested value.");
      }
      const success = current.value === args.value;
      return result(success, success, "HIGH", success ? "The observed selection matches the requested option." : "The selected value did not match the request.");
    }

    if (envelope.tool === "scroll_page") {
      const direction = args.direction;
      const oldY = before.viewport.scrollY;
      const newY = after.viewport.scrollY;
      const moved = direction === "down" || direction === "bottom" ? newY > oldY
        : direction === "up" || direction === "top" ? newY < oldY : false;
      return result(moved, moved, "HIGH", moved ? "The viewport moved in the requested direction." : "The viewport did not move in the requested direction.");
    }

    if (["go_back", "go_forward"].includes(envelope.tool)) {
      const moved = before.url !== after.url;
      return result(moved, moved, "HIGH", moved ? "The active tab URL changed." : "The active tab URL did not change.");
    }

    if (["click_element", "press_key"].includes(envelope.tool)) {
      const changed = before.url !== after.url || before.fingerprint !== after.fingerprint;
      return result(changed, changed, changed ? "HIGH" : "MEDIUM", changed ? "A page state change followed the action." : "No page state change was observed after the action.");
    }

    if (envelope.tool === "finish_task") return result(true, false, "LOW", "Task completion requires checking the declared success criteria.");
    return result(true, false, "HIGH", "The read-only step completed without requiring a page mutation.");
  }
}

function findSameElement(previous: ObservedElement, elements: ObservedElement[]): ObservedElement | undefined {
  const matches = elements.filter((element) => element.tagName === previous.tagName && element.role === previous.role && element.name === previous.name && element.placeholder === previous.placeholder);
  return matches.length === 1 ? matches[0] : undefined;
}
function canonicalUrl(value: string): string | null { try { return new URL(value).href; } catch { return null; } }
function result(progressMade: boolean, criteriaSatisfied: boolean, confidence: StepVerification["confidence"], details: string): StepVerification {
  return { progressMade, criteriaSatisfied, confidence, details };
}

import type { ObservedElement } from "./types.ts";
import { DOMObserver } from "./domObserver.ts";

export type RevalidationCode = "STALE_OBSERVATION" | "ELEMENT_DETACHED" | "ELEMENT_HIDDEN" | "ELEMENT_OBSCURED" | "ROLE_MISMATCH" | "ELEMENT_DISABLED";
export interface RevalidationResult { valid: boolean; element?: HTMLElement; code?: RevalidationCode; reason?: string; }

export class ElementRevalidator {
  private readonly observer: DOMObserver;
  private readonly doc: Document;
  private readonly win: Window;
  constructor(observer: DOMObserver, doc: Document = document, win: Window = window) { this.observer = observer; this.doc = doc; this.win = win; }

  revalidate(observationId: string, elementId: string, expected?: Partial<ObservedElement>): RevalidationResult {
    const current = this.observer.getObservationId();
    if (current !== observationId) return { valid: false, code: "STALE_OBSERVATION", reason: "The page changed after this observation; inspect it again before acting." };
    const element = this.observer.getElementById(elementId);
    if (!element || !element.isConnected || !this.doc.body.contains(element)) return { valid: false, code: "ELEMENT_DETACHED", reason: "The observed element is no longer attached to the page." };
    if ("disabled" in element && Boolean((element as HTMLButtonElement).disabled)) return { valid: false, code: "ELEMENT_DISABLED", reason: "The observed element is disabled." };
    const style = this.win.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0 || rect.width <= 0 || rect.height <= 0) {
      return { valid: false, code: "ELEMENT_HIDDEN", reason: "The observed element is no longer visible." };
    }
    if (expected?.tagName && element.tagName.toLowerCase() !== expected.tagName.toLowerCase()) return { valid: false, code: "ROLE_MISMATCH", reason: "The observed element type changed." };
    if (expected?.role && roleOf(element) !== expected.role) return { valid: false, code: "ROLE_MISMATCH", reason: "The observed element role changed." };
    const x = Math.max(0, Math.min(this.win.innerWidth - 1, rect.left + rect.width / 2));
    const y = Math.max(0, Math.min(this.win.innerHeight - 1, rect.top + rect.height / 2));
    if (rect.right > 0 && rect.bottom > 0 && rect.left < this.win.innerWidth && rect.top < this.win.innerHeight) {
      const top = this.doc.elementFromPoint(x, y);
      if (top && top !== element && !element.contains(top) && !top.contains(element)) return { valid: false, code: "ELEMENT_OBSCURED", reason: "Another page element covers the target." };
    }
    return { valid: true, element };
  }
}

function roleOf(element: HTMLElement): string {
  const explicit = element.getAttribute("role")?.trim().split(/\s+/)[0];
  if (explicit) return explicit.toLowerCase();
  if (element instanceof HTMLButtonElement) return "button";
  if (element instanceof HTMLAnchorElement) return "link";
  if (element instanceof HTMLSelectElement) return element.multiple ? "listbox" : "combobox";
  if (element instanceof HTMLTextAreaElement) return "textbox";
  if (element instanceof HTMLInputElement) return ({ checkbox: "checkbox", radio: "radio", submit: "button", button: "button" } as Record<string, string>)[element.type] ?? "textbox";
  return "generic";
}

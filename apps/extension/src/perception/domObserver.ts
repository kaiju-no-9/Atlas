import { PageObservationSchema, type ObservationMode, type ObservedElement, type PageObservation } from "./types.ts";

const CANDIDATE_SELECTOR = [
  "button", "a[href]", "input", "select", "textarea", "[role]", "[tabindex]:not([tabindex='-1'])",
].join(",");
const MAX_NODES = 5000;

/** Captures a bounded, semantic view of a page and keeps transient handles for one snapshot. */
export class DOMObserver {
  private readonly doc: Document;
  private readonly win: Window;
  private elements = new Map<string, HTMLElement>();
  private currentId: string | null = null;
  private dirty = true;
  private mutationObserver: MutationObserver | null = null;
  private readonly onMutation = () => { this.dirty = true; this.elements.clear(); };

  constructor(doc: Document = document, win: Window = window) { this.doc = doc; this.win = win; }

  async captureSnapshot(taskId: string, tabId: number, mode: ObservationMode = "interactive", budgetTokens?: number): Promise<PageObservation> {
    const safeTaskId = PageObservationSchema.shape.taskId.parse(taskId);
    const safeTabId = PageObservationSchema.shape.tabId.parse(tabId);
    const budget = budgetTokens ?? (mode === "compact" ? 2000 : mode === "full_limited" ? 8000 : 4000);
    if (!Number.isInteger(budget) || budget < 100 || budget > 8000) throw new RangeError("budgetTokens must be between 100 and 8000");
    this.disconnectMutationObserver();
    this.elements.clear();
    this.dirty = false;
    this.currentId = crypto.randomUUID();
    const root = this.doc.documentElement;
    this.mutationObserver = new MutationObserver(this.onMutation);
    if (root) this.mutationObserver.observe(root, { subtree: true, childList: true, attributes: true, characterData: true });
    const nodes = this.doc.querySelectorAll("*");
    const url = this.win.location.href;
    const viewport = {
      width: this.win.innerWidth, height: this.win.innerHeight, scrollX: this.win.scrollX, scrollY: this.win.scrollY,
      totalHeight: root?.scrollHeight ?? 0,
    };
    const headings = Array.from(this.doc.querySelectorAll("h1,h2,h3,h4,h5,h6"))
      .slice(0, 80).map((item) => ({ level: Number(item.tagName.slice(1)), text: normalize(item.textContent).slice(0, 120) })).filter((item) => item.text);
    const landmarks = Array.from(this.doc.querySelectorAll("main,nav,aside,header,footer,[role='main'],[role='navigation'],[role='complementary'],[role='banner'],[role='contentinfo']"))
      .slice(0, 40).map((el) => ({ role: el.getAttribute("role") || el.tagName.toLowerCase(), name: el.getAttribute("aria-label") || undefined }));
    const candidates = Array.from(this.doc.querySelectorAll<HTMLElement>(CANDIDATE_SELECTOR)).slice(0, MAX_NODES);
    const elements: ObservedElement[] = [];
    let usedTokens = 150;
    let truncated = nodes.length > MAX_NODES || candidates.length >= MAX_NODES;

    for (const el of candidates) {
      if (!isVisible(el, this.win)) continue;
      const rect = el.getBoundingClientRect();
      const inViewport = rect.bottom >= 0 && rect.right >= 0 && rect.top <= viewport.height && rect.left <= viewport.width;
      if (mode === "compact" && !inViewport && el !== this.doc.activeElement) continue;
      const id = `el_${elements.length + 1}`;
      const type = el.getAttribute("type")?.toLowerCase();
      const input = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;
      const isSensitive = input && ((el instanceof HTMLInputElement && ["password", "hidden"].includes(type ?? "")) || /cc-|password|one-time-code/i.test(el.getAttribute("autocomplete") ?? "") || /card|cvc|security code/i.test(`${el.getAttribute("name")} ${el.getAttribute("aria-label")}`));
      const item: ObservedElement = {
        id, tagName: el.tagName.toLowerCase(), role: accessibleRole(el), name: accessibleName(el).slice(0, 160),
        ...(input && !isSensitive ? { value: (el as HTMLInputElement | HTMLTextAreaElement).value.slice(0, 100) } : isSensitive ? { value: "[REDACTED_SENSITIVE]" } : el instanceof HTMLSelectElement ? { value: el.value.slice(0, 100) } : {}),
        ...(el.getAttribute("placeholder") ? { placeholder: el.getAttribute("placeholder")!.slice(0, 160) } : {}),
        disabled: "disabled" in el && Boolean((el as HTMLButtonElement).disabled),
        readOnly: "readOnly" in el ? Boolean((el as HTMLInputElement).readOnly) : undefined,
        checked: el instanceof HTMLInputElement && ["checkbox", "radio"].includes(el.type) ? el.checked : undefined,
        selected: el instanceof HTMLOptionElement ? el.selected : undefined,
        visible: true, inViewport,
        bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height, top: rect.top, left: rect.left },
        ...(el instanceof HTMLAnchorElement ? safeHref(el.href) : {}),
        ...(type ? { type } : {}),
        ...(el.hasAttribute("aria-expanded") ? { ariaExpanded: el.getAttribute("aria-expanded") === "true" } : {}),
        ...(el.hasAttribute("aria-required") ? { ariaRequired: el.getAttribute("aria-required") === "true" } : {}),
      };
      const itemTokens = Math.ceil(JSON.stringify(item).length / 4);
      if (usedTokens + itemTokens > budget) { truncated = true; break; }
      usedTokens += itemTokens;
      elements.push(item);
      this.elements.set(id, el);
    }

    const observation = PageObservationSchema.parse({
      observationId: this.currentId, taskId: safeTaskId, tabId: safeTabId, url, title: this.doc.title, mode,
      capturedAt: new Date().toISOString(), viewport, fingerprint: await fingerprint(`${url}\n${this.doc.title}\n${viewport.scrollY}\n${nodes.length}\n${root?.innerHTML.slice(0, 4000) ?? ""}\n${JSON.stringify(elements.map(({ id: _id, ...element }) => element))}`),
      headings, landmarks, elements, truncated, elementCount: elements.length,
    });
    if (this.dirty) {
      this.currentId = null;
      this.elements.clear();
      throw new Error("The page changed during observation; capture a fresh snapshot.");
    }
    return observation;
  }

  getObservationId(): string | null { return this.currentId; }
  getElementById(id: string): HTMLElement | null { return this.dirty ? null : this.elements.get(id) ?? null; }
  dispose(): void { this.disconnectMutationObserver(); this.elements.clear(); this.currentId = null; this.dirty = true; }
  private disconnectMutationObserver(): void { this.mutationObserver?.disconnect(); this.mutationObserver = null; }
}

function normalize(value: string | null): string { return (value ?? "").replace(/\s+/g, " ").trim(); }
function accessibleName(el: HTMLElement): string {
  const label = normalize(el.getAttribute("aria-label"));
  if (label) return label;
  const labelledBy = el.getAttribute("aria-labelledby");
  if (labelledBy) {
    const joined = labelledBy.split(/\s+/).map((id) => el.ownerDocument.getElementById(id)?.textContent ?? "").join(" ");
    if (normalize(joined)) return normalize(joined);
  }
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    if (el.labels?.length) return normalize(Array.from(el.labels).map((item) => item.textContent ?? "").join(" "));
    if (el.placeholder) return normalize(el.placeholder);
  }
  if (el instanceof HTMLImageElement && el.alt) return normalize(el.alt);
  return normalize(el.getAttribute("title") || el.innerText || el.textContent);
}
function accessibleRole(el: HTMLElement): string {
  const explicit = normalize(el.getAttribute("role")).split(" ")[0];
  if (explicit) return explicit.toLowerCase();
  if (el instanceof HTMLButtonElement) return "button";
  if (el instanceof HTMLAnchorElement) return "link";
  if (el instanceof HTMLSelectElement) return el.multiple ? "listbox" : "combobox";
  if (el instanceof HTMLTextAreaElement) return "textbox";
  if (el instanceof HTMLInputElement) return ({ checkbox: "checkbox", radio: "radio", button: "button", submit: "button", reset: "button", range: "slider" } as Record<string, string>)[el.type] ?? "textbox";
  return ({ main: "main", nav: "navigation", header: "banner", footer: "contentinfo", aside: "complementary" } as Record<string, string>)[el.tagName.toLowerCase()] ?? "generic";
}
function isVisible(el: HTMLElement, win: Window): boolean {
  if (!el.isConnected || ("disabled" in el && Boolean((el as HTMLButtonElement).disabled))) return false;
  const style = win.getComputedStyle(el);
  if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}
function safeHref(href: string): { href?: string } {
  try { const parsed = new URL(href); return ["http:", "https:"].includes(parsed.protocol) ? { href: parsed.href } : {}; }
  catch { return {}; }
}
async function fingerprint(value: string): Promise<string> {
  if (!crypto.subtle) throw new Error("SHA-256 is unavailable in this isolated content context.");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return `sha256-${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

import type { ContentAction, ContentActionResponse } from "../../../../packages/contracts/src/messages.ts";
import type { PageObservation, ObservedElement } from "./types.ts";

type StoredSnapshot = { id: string; elements: Map<string, HTMLElement>; profiles: Map<string, ObservedElement>; dirty: boolean; observer: MutationObserver; onScroll: () => void };
type IsolatedWindow = Window & { __atlasPerceptionSnapshot?: StoredSnapshot };

/**
 * Serialized by ScriptInjector into the extension isolated world. Keep all runtime
 * work self-contained: web page JavaScript cannot reach this world or extension APIs.
 */
export async function runContentAction(action: ContentAction): Promise<ContentActionResponse> {
  // Chrome serializes only this function, so keep every runtime dependency local.
  const normalize = (value: string | null) => (value ?? "").replace(/\s+/g, " ").trim();
  const safeHref = (value: string): { href?: string } => { try { const url = new URL(value); return url.protocol === "http:" || url.protocol === "https:" ? { href: url.href } : {}; } catch { return {}; } };
  const fingerprint = async (value: string) => {
    if (!crypto.subtle) throw new Error("SHA-256 is unavailable in this isolated content context.");
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
    return `sha256-${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
  };
  const accessibleName = (element: HTMLElement): string => {
    const direct = element.getAttribute("aria-label")?.trim(); if (direct) return direct;
    const labels = element.getAttribute("aria-labelledby")?.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? "").join(" ").replace(/\s+/g, " ").trim(); if (labels) return labels;
    if ((element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) && element.labels?.length) return Array.from(element.labels).map((label) => label.textContent ?? "").join(" ").replace(/\s+/g, " ").trim();
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) return element.placeholder.trim();
    if (element instanceof HTMLImageElement && element.alt) return element.alt.trim();
    return (element.getAttribute("title") || element.innerText || element.textContent || "").replace(/\s+/g, " ").trim();
  };
  const roleOf = (element: HTMLElement): string => {
    const explicit = element.getAttribute("role")?.trim().split(/\s+/)[0]; if (explicit) return explicit.toLowerCase();
    if (element instanceof HTMLButtonElement) return "button"; if (element instanceof HTMLAnchorElement) return "link";
    if (element instanceof HTMLSelectElement) return element.multiple ? "listbox" : "combobox"; if (element instanceof HTMLTextAreaElement) return "textbox";
    if (element instanceof HTMLInputElement) return ({ checkbox: "checkbox", radio: "radio", submit: "button", button: "button", reset: "button", range: "slider" } as Record<string, string>)[element.type] ?? "textbox";
    return ({ main: "main", nav: "navigation", header: "banner", footer: "contentinfo", aside: "complementary" } as Record<string, string>)[element.tagName.toLowerCase()] ?? "generic";
  };
  const isVisible = (element: HTMLElement): boolean => {
    if (!element.isConnected) return false;
    const style = window.getComputedStyle(element); const rect = element.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) !== 0 && rect.width > 0 && rect.height > 0;
  };
  const safeFieldValue = (element: HTMLElement): string | undefined => {
    if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) return undefined;
    const sensitive = (element instanceof HTMLInputElement && ["password", "hidden"].includes(element.type.toLowerCase())) || /cc-|password|one-time-code/i.test(element.getAttribute("autocomplete") ?? "") || /card|cvc|security code/i.test(`${element.getAttribute("name")} ${element.getAttribute("aria-label")}`);
    return sensitive ? "[REDACTED_SENSITIVE]" : element.value.slice(0, 100);
  };
  const fail = (error: string): ContentActionResponse => ({ success: false, error });
  const ok = (payload: Record<string, unknown>): ContentActionResponse => ({ success: true, payload });
  const revalidationFailure = (target: HTMLElement, expected: ObservedElement): string | null => {
    if (target.tagName.toLowerCase() !== expected.tagName || roleOf(target) !== expected.role) return "ROLE_MISMATCH: target semantics changed; observe again.";
    if (!isVisible(target) || ("disabled" in target && Boolean((target as HTMLButtonElement).disabled))) return "ELEMENT_NOT_INTERACTABLE: target is hidden or disabled.";
    const rect = target.getBoundingClientRect();
    if (rect.bottom > 0 && rect.right > 0 && rect.top < innerHeight && rect.left < innerWidth) {
      const top = document.elementFromPoint(Math.max(0, Math.min(innerWidth - 1, rect.left + rect.width / 2)), Math.max(0, Math.min(innerHeight - 1, rect.top + rect.height / 2)));
      if (top && top !== target && !target.contains(top) && !top.contains(target)) return "ELEMENT_OBSCURED: another page element covers the target.";
    }
    return null;
  };
  const executeGroundedAction = (call: Extract<ContentAction, { type: "EXECUTE_TOOL" }>["payload"]): ContentActionResponse => {
    const page = window as IsolatedWindow; const snapshot = page.__atlasPerceptionSnapshot; const args = call.arguments;
    if (["click_element", "type_text", "select_option"].includes(call.tool)) {
      const observationId = typeof args.observationId === "string" ? args.observationId : ""; const elementId = typeof args.elementId === "string" ? args.elementId : "";
      if (!snapshot || snapshot.dirty || snapshot.id !== observationId) return fail("STALE_OBSERVATION: inspect the page again before acting.");
      if (!/^el_[1-9]\d*$/.test(elementId)) return fail("ELEMENT_NOT_FOUND: element ID is malformed.");
      const target = snapshot.elements.get(elementId); const profile = snapshot.profiles.get(elementId);
      if (!target || !profile || !target.isConnected || !document.body.contains(target)) return fail("ELEMENT_NOT_FOUND: target is no longer on the page.");
      target.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
      const invalid = revalidationFailure(target, profile); if (invalid) return fail(invalid);
      if (call.tool === "click_element") {
        if (!target.matches("button,a[href],input[type=button],input[type=submit],[role=button],[role=link],[role=menuitem],[role=tab]")) return fail("ELEMENT_NOT_INTERACTABLE: target is not a clickable control.");
        if (target instanceof HTMLAnchorElement) {
          const href = safeHref(target.href).href;
          if (!href || new URL(href).origin !== window.location.origin || target.target === "_blank") return fail("POLICY_VIOLATION: cross-origin and new-tab links must use an explicitly approved navigation tool.");
        }
        target.click(); return ok({ clicked: true, bounds: profile.bounds });
      }
      if (call.tool === "type_text") {
        const text = args.text;
        if (typeof text !== "string" || text.length > 2000) return fail("INVALID_ARGUMENTS: text must be at most 2000 characters.");
        if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) || target.readOnly || !((target instanceof HTMLTextAreaElement) || ["text", "email", "search", "tel", "url", "number"].includes(target.type.toLowerCase()))) return fail("POLICY_VIOLATION: target is not a safe text field.");
        const value = args.clearBefore === true ? text : `${target.value}${text}`;
        const prototype = target instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
        Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(target, value);
        target.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text })); target.dispatchEvent(new Event("change", { bubbles: true }));
      if (target.value !== value) return fail("EXECUTION_FAILED: the field did not retain the requested value.");
        return ok({ typedLength: text.length });
      }
      if (!(target instanceof HTMLSelectElement) || typeof args.value !== "string") return fail("INVALID_ARGUMENTS: a select element and string value are required.");
      const option = Array.from(target.options).find((item) => item.value === args.value && !item.disabled);
      if (!option) return fail("INVALID_ARGUMENTS: requested option is not available.");
      target.value = option.value; target.dispatchEvent(new Event("input", { bubbles: true })); target.dispatchEvent(new Event("change", { bubbles: true }));
      return target.value === option.value ? ok({ selectedValue: option.value }) : fail("EXECUTION_FAILED: select value did not update.");
    }
    if (call.tool === "press_key") {
      const allowed = ["Enter", "Tab", "Escape", "Backspace", "Delete", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "PageUp", "PageDown", "Home", "End", "Space"];
      const key = args.key; if (typeof key !== "string" || !allowed.includes(key)) return fail("INVALID_ARGUMENTS: key is not allowed.");
      const modifiers = Array.isArray(args.modifiers) ? args.modifiers : [];
      if (modifiers.length > 2 || modifiers.some((item) => !["Control", "Alt", "Shift", "Meta"].includes(String(item)))) return fail("INVALID_ARGUMENTS: unsupported key modifiers.");
      if (modifiers.some((item) => ["Meta", "Alt", "Control"].includes(String(item)))) return fail("POLICY_VIOLATION: browser or operating system shortcuts are blocked.");
      const target = document.activeElement; if (!(target instanceof HTMLElement)) return fail("ELEMENT_NOT_INTERACTABLE: no active page element.");
      const eventKey = key === "Space" ? " " : key; const init = { key: eventKey, bubbles: true, cancelable: true, shiftKey: modifiers.includes("Shift") };
      target.dispatchEvent(new KeyboardEvent("keydown", init)); target.dispatchEvent(new KeyboardEvent("keyup", init)); return ok({ dispatched: true });
    }
    if (call.tool === "scroll_page") {
      const direction = args.direction; const amount = args.amount === undefined ? 500 : args.amount;
      if (!["up", "down", "top", "bottom"].includes(String(direction)) || typeof amount !== "number" || amount < 50 || amount > 1200) return fail("INVALID_ARGUMENTS: scroll must be bounded to 50–1200 pixels.");
      const before = window.scrollY; const top = direction === "top" ? 0 : direction === "bottom" ? document.documentElement.scrollHeight : before + (direction === "down" ? amount : -amount);
      window.scrollTo({ top, behavior: "instant" }); const currentScrollY = window.scrollY;
      return ok({ currentScrollY, hitLimit: currentScrollY === before || (direction === "top" && currentScrollY === 0) || (direction === "bottom" && currentScrollY + window.innerHeight >= document.documentElement.scrollHeight) });
    }
    return fail("TOOL_NOT_AVAILABLE_IN_CONTENT: this action is handled by the trusted background adapter.");
  };
  const waitForState = (action: Extract<ContentAction, { type: "WAIT_FOR_STATE" }>): Promise<ContentActionResponse> => {
    const started = performance.now();
    const state = (window as IsolatedWindow).__atlasPerceptionSnapshot;
    if ((action.condition === "element_present" || action.condition === "element_gone") && (!state || state.id !== action.observationId || state.dirty)) {
      return Promise.resolve(fail("STALE_OBSERVATION: observe the page again before waiting on an element."));
    }
    const target = action.elementId ? state?.elements.get(action.elementId) : undefined;
    if ((action.condition === "element_present" || action.condition === "element_gone") && !target) return Promise.resolve(fail("ELEMENT_NOT_FOUND: element was not present in the referenced observation."));
    if (action.condition === "element_present" && target?.isConnected) return Promise.resolve(ok({ satisfied: true, elapsedMs: 0 }));
    if (action.condition === "element_gone" && target && !target.isConnected) return Promise.resolve(ok({ satisfied: true, elapsedMs: 0 }));
    const fromUrl = action.fromUrl;
    if (action.condition === "url_changed" && fromUrl && window.location.href !== fromUrl) return Promise.resolve(ok({ satisfied: true, elapsedMs: 0 }));
    return new Promise((resolve) => {
      let lastMutation = performance.now();
      let finished = false;
      const observer = new MutationObserver(() => { lastMutation = performance.now(); });
      observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
      const interval = setInterval(() => {
        const elapsedMs = performance.now() - started;
        let satisfied = false;
        if (action.condition === "element_gone") satisfied = Boolean(target && !target.isConnected);
        else if (action.condition === "url_changed") satisfied = Boolean(fromUrl && window.location.href !== fromUrl);
        else if (action.condition === "dom_quiescent") satisfied = performance.now() - lastMutation >= 300;
        if (satisfied || elapsedMs >= action.timeoutMs) {
          finished = true;
          clearInterval(interval);
          observer.disconnect();
          resolve(ok({ satisfied, elapsedMs }));
        }
      }, 50);
      // Keep an explicit guard for timer implementations that do not run while a tab is backgrounded.
      setTimeout(() => {
        if (finished) return;
        finished = true;
        clearInterval(interval);
        observer.disconnect();
        resolve(ok({ satisfied: false, elapsedMs: performance.now() - started }));
      }, action.timeoutMs + 50);
    });
  };
  switch (action.type) {
    case "PING":
      return { success: true, payload: { ready: true, url: window.location.href } };
    case "OBSERVE_DOM": {
      const page = window as IsolatedWindow;
      const previous = page.__atlasPerceptionSnapshot;
      previous?.observer.disconnect();
      if (previous) window.removeEventListener("scroll", previous.onScroll, true);
      const mode = action.mode ?? "interactive";
      const budgetTokens = mode === "compact" ? 2000 : mode === "full_limited" ? 8000 : 4000;
      const observationId = crypto.randomUUID();
      const elements = new Map<string, HTMLElement>();
      const profiles = new Map<string, ObservedElement>();
      let changedDuringCapture = false;
      const mutationObserver = new MutationObserver(() => {
        const snapshot = page.__atlasPerceptionSnapshot;
        if (snapshot?.id === observationId) { snapshot.dirty = true; snapshot.elements.clear(); }
        else changedDuringCapture = true;
      });
      mutationObserver.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
      const onScroll = () => {
        const snapshot = page.__atlasPerceptionSnapshot;
        if (snapshot?.id === observationId) { snapshot.dirty = true; snapshot.elements.clear(); }
        else changedDuringCapture = true;
      };
      window.addEventListener("scroll", onScroll, true);
      const interactiveSelector = "button,a[href],input,select,textarea,[role],[tabindex]:not([tabindex='-1'])";
      const candidateSelector = mode === "full_limited" ? `${interactiveSelector},p,h1,h2,h3,li,article` : interactiveSelector;
      const candidates = document.querySelectorAll<HTMLElement>(candidateSelector);
      const headings = Array.from(document.querySelectorAll("h1,h2,h3,h4,h5,h6")).slice(0, 80).map((heading) => ({
        level: Number(heading.tagName.slice(1)), text: normalize(heading.textContent).slice(0, 120),
      })).filter((heading) => heading.text.length > 0);
      const landmarks = Array.from(document.querySelectorAll("main,nav,aside,header,footer,[role='main'],[role='navigation'],[role='complementary'],[role='banner'],[role='contentinfo']")).slice(0, 40).map((element) => ({
        role: element.getAttribute("role") || element.tagName.toLowerCase(), name: element.getAttribute("aria-label") || undefined,
      }));
      const viewport = { width: window.innerWidth, height: window.innerHeight, scrollX: window.scrollX, scrollY: window.scrollY, totalHeight: document.documentElement.scrollHeight };
      const observed: ObservedElement[] = [];
      let estimatedTokens = 150;
      let truncated = document.querySelectorAll("*").length > 5000;
      const limit = Math.min(candidates.length, 5000);
      for (let index = 0; index < limit; index += 1) {
        const element = candidates.item(index);
        if (!element || !isVisible(element)) continue;
        const rect = element.getBoundingClientRect();
        const inViewport = rect.bottom >= 0 && rect.right >= 0 && rect.top <= viewport.height && rect.left <= viewport.width;
        if (mode === "compact" && !inViewport && element !== document.activeElement) continue;
        const id = `el_${observed.length + 1}`;
        const value = safeFieldValue(element);
        const profile: ObservedElement = {
          id,
          tagName: element.tagName.toLowerCase(),
          role: roleOf(element),
          name: accessibleName(element).slice(0, 160),
          ...(value !== undefined ? { value } : element instanceof HTMLSelectElement ? { value: element.value } : {}),
          ...(element.getAttribute("placeholder") ? { placeholder: element.getAttribute("placeholder")!.slice(0, 160) } : {}),
          disabled: "disabled" in element && Boolean((element as HTMLButtonElement).disabled),
          ...( "readOnly" in element ? { readOnly: Boolean((element as HTMLInputElement).readOnly) } : {}),
          ...(element instanceof HTMLInputElement && ["checkbox", "radio"].includes(element.type) ? { checked: element.checked } : {}),
          ...(element instanceof HTMLOptionElement ? { selected: element.selected } : {}),
          visible: true,
          inViewport,
          bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height, top: rect.top, left: rect.left },
          ...(element instanceof HTMLAnchorElement ? safeHref(element.href) : {}),
          ...(element.getAttribute("type") ? { type: element.getAttribute("type")!.toLowerCase() } : {}),
          ...(element.hasAttribute("aria-expanded") ? { ariaExpanded: element.getAttribute("aria-expanded") === "true" } : {}),
          ...(element.hasAttribute("aria-required") ? { ariaRequired: element.getAttribute("aria-required") === "true" } : {}),
        };
        const tokenCost = Math.ceil(JSON.stringify(profile).length / 4);
        if (estimatedTokens + tokenCost > budgetTokens) { truncated = true; break; }
        estimatedTokens += tokenCost;
        observed.push(profile);
        elements.set(id, element);
        profiles.set(id, profile);
      }
      if (candidates.length > limit) truncated = true;
      const taskId = action.taskId ?? crypto.randomUUID();
      const tabId = action.tabId ?? 0;
      const pageObservation: PageObservation = {
        observationId, taskId, tabId, url: window.location.href, title: document.title, mode,
        capturedAt: new Date().toISOString(), viewport,
        fingerprint: await fingerprint(`${window.location.href}|${document.title}|${window.scrollY}|${document.querySelectorAll("*").length}|${Array.from(profiles.values(), (profile) => `${profile.tagName}:${profile.role}:${profile.name}:${profile.value ?? ""}:${profile.checked ?? ""}:${profile.disabled}`).join("|")}`),
        headings, landmarks, elements: observed, truncated, elementCount: observed.length,
      };
      if (changedDuringCapture) {
        mutationObserver.disconnect();
        window.removeEventListener("scroll", onScroll, true);
        return fail("STALE_OBSERVATION: the page changed while its observation was being captured; inspect it again.");
      }
      page.__atlasPerceptionSnapshot = { id: observationId, elements, profiles, dirty: false, observer: mutationObserver, onScroll };
      return { success: true, payload: {
        url: window.location.href, title: document.title, elementCount: document.querySelectorAll("*").length,
        text: (document.body?.innerText ?? "").slice(0, 5000), observation: pageObservation,
      } };
    }
    case "EXECUTE_TOOL":
      return executeGroundedAction(action.payload);
    case "WAIT_FOR_STATE":
      return waitForState(action);
  }
}

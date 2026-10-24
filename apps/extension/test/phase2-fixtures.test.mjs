import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import vm from "node:vm";
import { runContentAction } from "../src/perception/contentActions.ts";
import { PageObservationSchema } from "../src/perception/types.ts";
import { ToolSchemas } from "../src/tools/registry.ts";

const fixture = (name) => fileURLToPath(new URL(`../../../evals/fixtures/${name}`, import.meta.url));

test("form and dynamic DOM fixtures provide local-only browser action plans", async () => {
  const [form, dynamic] = await Promise.all([
    readFile(fixture("form_fixture.html"), "utf8"),
    readFile(fixture("dynamic_dom.html"), "utf8"),
  ]);

  assert.match(form, /id="display-name"/);
  assert.match(form, /id="plan"/);
  assert.match(form, /id="account-password"[^>]*type="password"/);
  assert.match(form, /id="disabled-action"[^>]*disabled/);
  assert.match(form, /event\.preventDefault\(\)/);
  assert.doesNotMatch(form, /<form[^>]+action=/i);
  assert.doesNotMatch(form, /https?:\/\//i);

  assert.match(dynamic, /id="scheduled-removal"/);
  assert.match(dynamic, /id="changing-label"/);
  assert.match(dynamic, /setTimeout\([\s\S]*500/);
  assert.match(dynamic, /\.remove\(\)/);
  assert.match(dynamic, /setAttribute\("aria-label", "After mutation"\)/);
  assert.doesNotMatch(dynamic, /https?:\/\//i);

  const observationId = "33333333-3333-4333-8333-333333333333";
  const formPlan = [
    ["type_text", { observationId, elementId: "el_1", text: "Atlas Test", clearBefore: true }],
    ["select_option", { observationId, elementId: "el_2", value: "pro" }],
    ["click_element", { observationId, elementId: "el_3" }],
  ];
  for (const [tool, args] of formPlan) assert.equal(ToolSchemas[tool].input.safeParse(args).success, true);
  assert.equal(ToolSchemas.wait_for_state.input.safeParse({
    condition: "element_gone", observationId, elementId: "el_1", timeoutMs: 1500,
  }).success, true);
});

test("form fixture action plan types and selects fields through grounded element IDs", async () => {
  class Element {
    constructor(tagName, label, attrs = {}) { this.tagName = tagName.toUpperCase(); this.innerText = label; this.textContent = label; this.labels = [{ textContent: label }]; this.attributes = new Map(Object.entries(attrs)); this.isConnected = true; this.disabled = false; }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    hasAttribute(name) { return this.attributes.has(name); }
    getBoundingClientRect() { return { x: 20, y: 30, left: 20, top: 30, right: 160, bottom: 60, width: 140, height: 30 }; }
    scrollIntoView() {}
    contains() { return false; }
    dispatchEvent() { return true; }
  }
  class Input extends Element {
    constructor(label, attrs = {}) { super("input", label, attrs); this.type = attrs.type ?? "text"; this.placeholder = attrs.placeholder ?? ""; this.readOnly = false; this._value = ""; }
    get value() { return this._value; }
    set value(value) { this._value = value; }
  }
  class Select extends Element {
    constructor() { super("select", "Plan", { name: "plan" }); this.multiple = false; this.options = [{ value: "basic", disabled: false }, { value: "pro", disabled: false }]; this.value = "basic"; }
  }
  class Button extends Element {
    constructor(label, attrs = {}) { super("button", label, { type: "button", ...attrs }); this.disabled = Object.hasOwn(attrs, "disabled"); }
    matches() { return true; }
    click() { this.clickCount = (this.clickCount ?? 0) + 1; }
  }
  const field = new Input("Display name", { type: "text", name: "displayName", placeholder: "Your name" });
  const password = new Input("Password", { type: "password", name: "password", autocomplete: "current-password" });
  const select = new Select();
  const disabledButton = new Button("Unavailable", { id: "disabled-action", disabled: "" });
  const click = new Button("Save profile", { type: "submit" });
  const observers = [];
  class Observer { constructor(callback) { this.callback = callback; observers.push(this); } observe() {} disconnect() {} }
  const elements = [field, password, select, disabledButton, click];
  const document = { title: "Form", documentElement: { scrollHeight: 800 }, body: { innerText: "Profile", contains: (el) => el.isConnected }, activeElement: null, getElementById: () => null, elementFromPoint: () => null, querySelectorAll(selector) { if (selector === "*") return { length: 30 }; if (selector.startsWith("button,a[href]")) return { length: elements.length, item: (index) => elements[index] ?? null }; return []; } };
  const window = { location: { href: "http://localhost/form_fixture.html" }, innerWidth: 800, innerHeight: 600, scrollX: 0, scrollY: 0, addEventListener() {}, removeEventListener() {}, getComputedStyle: () => ({ display: "block", visibility: "visible", opacity: "1" }) };
  const isolated = vm.createContext({ window, document, crypto: globalThis.crypto, TextEncoder, MutationObserver: Observer, HTMLElement: Element, HTMLButtonElement: Button, HTMLAnchorElement: class {}, HTMLInputElement: Input, HTMLTextAreaElement: class {}, HTMLSelectElement: Select, HTMLImageElement: class {}, HTMLOptionElement: class {}, innerWidth: 800, innerHeight: 600, performance, setTimeout, setInterval, clearTimeout, clearInterval, URL, Date, Math, JSON, Array, Number, String, Object, Map, Promise, InputEvent: class {}, Event: class {}, KeyboardEvent: class {} });
  const action = vm.runInContext(`(${runContentAction.toString()})`, isolated);
  const taskId = "5c193d5e-8210-4ed5-9d82-b186e3bb48a0";
  const makeCall = (observationId, tool, args) => ({ type: "EXECUTE_TOOL", payload: { protocolVersion: 1, taskId, callId: "d9f6de2b-8d5b-4b9e-8af4-8589c53ac0e3", tool, arguments: args, reason: "Complete the local fixture plan", expectedOutcome: "The requested fixture state is reached" } });
  let response = await action({ type: "OBSERVE_DOM", taskId, tabId: 7, mode: "interactive" });
  let observation = PageObservationSchema.parse(response.payload.observation);
  assert.equal(observation.elements[0].name, "Display name");
  assert.equal(observation.elements.find((el) => el.name === "Password").value, "[REDACTED_SENSITIVE]");
  const passwordId = observation.elements.find((el) => el.name === "Password").id;
  let result = await action(makeCall(observation.observationId, "type_text", { observationId: observation.observationId, elementId: passwordId, text: "secret" }));
  assert.equal(result.success, false);
  assert.match(result.error, /safe text field/);
  const disabledId = observation.elements.find((el) => el.name === "Unavailable").id;
  result = await action(makeCall(observation.observationId, "click_element", { observationId: observation.observationId, elementId: disabledId }));
  assert.equal(result.success, false);
  assert.match(result.error, /hidden or disabled/);
  result = await action(makeCall(observation.observationId, "type_text", { observationId: observation.observationId, elementId: "el_1", text: "Atlas Test", clearBefore: true }));
  assert.equal(result.success, true);
  assert.equal(field.value, "Atlas Test");
  observers.at(-1).callback();

  response = await action({ type: "OBSERVE_DOM", taskId, tabId: 7, mode: "interactive" });
  observation = PageObservationSchema.parse(response.payload.observation);
  const planId = observation.elements.find((el) => el.name === "Plan").id;
  result = await action(makeCall(observation.observationId, "select_option", { observationId: observation.observationId, elementId: planId, value: "pro" }));
  assert.equal(result.success, true);
  assert.equal(select.value, "pro");
  const submitId = observation.elements.find((el) => el.name === "Save profile").id;
  result = await action(makeCall(observation.observationId, "click_element", { observationId: observation.observationId, elementId: submitId }));
  assert.equal(result.success, true);
  assert.equal(click.clickCount, 1);
  assert.ok(observers.length >= 2);
});

test("dynamic fixture detachment invalidates the previously observed action ID", async () => {
  const html = await readFile(fixture("dynamic_dom.html"), "utf8");
  const script = html.match(/<script>([\s\S]*?)<\/script>/i)?.[1];
  assert.ok(script);
  const observers = [];
  class Observer { constructor(callback) { this.callback = callback; observers.push(this); } observe() {} disconnect() {} }
  class Button {
    constructor(id, label) { this.tagName = "BUTTON"; this.id = id; this.label = label; this.isConnected = true; this.disabled = false; this.innerText = label; this.textContent = label; this.attributes = new Map([["id", id], ["type", "button"]]); }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    setAttribute(name, value) { this.attributes.set(name, value); }
    hasAttribute(name) { return this.attributes.has(name); }
    getBoundingClientRect() { return { x: 20, y: 30, left: 20, top: 30, right: 180, bottom: 60, width: 160, height: 30 }; }
    scrollIntoView() {}
    matches() { return true; }
    contains() { return false; }
    click() { this.clickCount = (this.clickCount ?? 0) + 1; }
    remove() { this.isConnected = false; }
  }
  const target = new Button("scheduled-removal", "Disappears after 500 ms");
  const changing = new Button("changing-label", "Stable node, changing name");
  changing.attributes.set("aria-label", "Before mutation");
  const buttons = [target, changing];
  const document = {
    title: "Dynamic fixture", documentElement: { scrollHeight: 800 }, body: { innerText: "Dynamic controls", contains: (el) => el.isConnected },
    activeElement: null, getElementById: () => null, elementFromPoint: () => null,
    querySelector(selector) { return buttons.find((el) => selector === `#${el.id}`) ?? null; },
    querySelectorAll(selector) {
      if (selector === "*") return { length: 10 };
      if (selector.startsWith("button,a[href]")) return { length: buttons.length, item: (index) => buttons[index] ?? null };
      return [];
    },
  };
  const window = { location: { href: "http://localhost/dynamic_dom.html" }, innerWidth: 800, innerHeight: 600, scrollX: 0, scrollY: 0, addEventListener() {}, removeEventListener() {}, getComputedStyle: () => ({ display: "block", visibility: "visible", opacity: "1" }) };
  const isolated = vm.createContext({ window, document, crypto: globalThis.crypto, TextEncoder, MutationObserver: Observer, HTMLElement: Button, HTMLButtonElement: Button, HTMLAnchorElement: class {}, HTMLInputElement: class {}, HTMLTextAreaElement: class {}, HTMLSelectElement: class {}, HTMLImageElement: class {}, HTMLOptionElement: class {}, innerWidth: 800, innerHeight: 600, performance, setTimeout, setInterval, clearTimeout, clearInterval, URL, Date, Math, JSON, Array, Number, String, Object, Map, Promise, InputEvent: class {}, Event: class {}, KeyboardEvent: class {} });
  const action = vm.runInContext(`(${runContentAction.toString()})`, isolated);
  const taskId = "5c193d5e-8210-4ed5-9d82-b186e3bb48a0";
  const response = await action({ type: "OBSERVE_DOM", taskId, tabId: 7, mode: "interactive" });
  const observation = PageObservationSchema.parse(response.payload.observation);
  assert.equal(observation.elements[0].name, "Disappears after 500 ms");
  vm.runInNewContext(script, { document, setTimeout });
  await new Promise((resolve) => setTimeout(resolve, 550));
  assert.equal(target.isConnected, false);
  assert.equal(changing.getAttribute("aria-label"), "After mutation");
  observers[0].callback();
  const stale = await action({ type: "EXECUTE_TOOL", payload: {
    protocolVersion: 1, taskId, callId: "d9f6de2b-8d5b-4b9e-8af4-8589c53ac0e3", tool: "click_element",
    arguments: { observationId: observation.observationId, elementId: "el_1" }, reason: "Use observed control", expectedOutcome: "The control is clicked",
  } });
  assert.equal(stale.success, false);
  assert.match(stale.error, /STALE_OBSERVATION/);
});

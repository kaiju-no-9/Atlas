import assert from "node:assert/strict";
import vm from "node:vm";
import { afterEach, test } from "node:test";
import { ScriptInjector } from "../src/browser/ScriptInjector.ts";
import { runContentAction } from "../src/perception/contentActions.ts";
import { PageObservationSchema } from "../src/perception/types.ts";

const originalChrome = globalThis.chrome;
const originalWindow = globalThis.window;
const originalDocument = globalThis.document;
const originalMutationObserver = globalThis.MutationObserver;

afterEach(() => {
  globalThis.chrome = originalChrome;
  globalThis.window = originalWindow;
  globalThis.document = originalDocument;
  globalThis.MutationObserver = originalMutationObserver;
});

function installPage(text = "fixture page text") {
  globalThis.window = { location: { href: "https://fixture.test/page" }, addEventListener() {}, removeEventListener() {} };
  globalThis.document = {
    title: "Fixture page",
    body: { innerText: text, children: [] },
    documentElement: { scrollHeight: 900 },
    activeElement: null,
    querySelectorAll(selector) { return selector === "*" ? Array(7).fill(null) : []; },
  };
  globalThis.MutationObserver = class { observe() {} disconnect() {} };
}

function installInjectionMock() {
  const calls = [];
  globalThis.chrome = {
    scripting: {
      async executeScript(details) {
        calls.push(details);
        return [{ result: await details.func(...(details.args ?? [])) }];
      },
    },
  };
  return calls;
}

test("injects a validated DOM observation into the isolated world", async () => {
  installPage();
  const calls = installInjectionMock();
  const injector = new ScriptInjector();

  const payload = await injector.sendContentAction(19, { type: "OBSERVE_DOM" });

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].target, { tabId: 19 });
  assert.equal(calls[0].world, "ISOLATED");
  assert.equal(payload.url, "https://fixture.test/page");
  assert.equal(payload.title, "Fixture page");
  assert.equal(payload.elementCount, 7);
  assert.equal(payload.text, "fixture page text");
});

test("rejects malformed actions before injecting anything", async () => {
  const calls = installInjectionMock();
  const injector = new ScriptInjector();

  await assert.rejects(injector.sendContentAction(19, { type: "PING", payload: { code: "arbitrary" } }));
  assert.equal(calls.length, 0);
});

test("caps page text and rejects grounded actions when their observation is stale", async () => {
  installPage("x".repeat(6000));
  installInjectionMock();
  const injector = new ScriptInjector();

  assert.equal((await injector.readVisibleText(19)).length, 5000);
  await assert.rejects(injector.sendContentAction(19, {
    type: "EXECUTE_TOOL",
    payload: {
      protocolVersion: 1,
      taskId: "5c193d5e-8210-4ed5-9d82-b186e3bb48a0",
      callId: "d9f6de2b-8d5b-4b9e-8af4-8589c53ac0e3",
      tool: "click_element",
      arguments: { observationId: "f987d3fc-cc88-4c80-96c8-55dc59537985", elementId: "el_1" },
      reason: "fixture",
      expectedOutcome: "fixture",
    },
  }), /STALE_OBSERVATION/);
});

test("serialized isolated-world observer grounds clicks and invalidates IDs after mutation", async () => {
  let clickCount = 0;
  const observers = [];
  const scrollListeners = [];
  class Button {
    tagName = "BUTTON";
    isConnected = true;
    disabled = false;
    innerText = "Continue";
    textContent = "Continue";
    ownerDocument = null;
    getAttribute(name) { return name === "type" ? "button" : null; }
    hasAttribute() { return false; }
    getBoundingClientRect() { return { x: 12, y: 20, left: 12, top: 20, right: 100, bottom: 48, width: 88, height: 28 }; }
    matches(selector) { return selector.includes("button"); }
    contains(other) { return other === this; }
    click() { clickCount += 1; }
    scrollIntoView() {}
  }
  const button = new Button();
  class Observer { constructor(callback) { this.callback = callback; observers.push(this); } observe() {} disconnect() {} }
  const document = {
    title: "Fixture", documentElement: { scrollHeight: 900, innerHTML: "fixture" }, body: { innerText: "Fixture page", children: [], contains: (node) => node === button },
    activeElement: null, getElementById: () => null, elementFromPoint: () => button,
    querySelectorAll(selector) {
      if (selector === "*") return [];
      if (selector.startsWith("button,a[href]")) return { 0: button, length: 1, item(index) { return index === 0 ? button : null; } };
      return [];
    },
  };
  button.ownerDocument = document;
  const window = { location: { href: "https://fixture.test/" }, innerWidth: 800, innerHeight: 600, scrollX: 0, scrollY: 0, addEventListener(_type, listener) { scrollListeners.push(listener); }, removeEventListener() {}, getComputedStyle: () => ({ display: "block", visibility: "visible", opacity: "1" }) };
  const isolated = vm.createContext({
    window, document, crypto: globalThis.crypto, TextEncoder, MutationObserver: Observer, HTMLElement: Button, HTMLButtonElement: Button,
    HTMLAnchorElement: class {}, HTMLInputElement: class {}, HTMLTextAreaElement: class {}, HTMLSelectElement: class {}, HTMLImageElement: class {}, HTMLOptionElement: class {},
    innerWidth: 800, innerHeight: 600, performance, setTimeout, setInterval, clearTimeout, clearInterval,
    URL, Date, Math, JSON, Array, Number, String, Object, Map, Promise, InputEvent: class {}, Event: class {}, KeyboardEvent: class {},
  });
  const serializedAction = vm.runInContext(`(${runContentAction.toString()})`, isolated);
  const taskId = "5c193d5e-8210-4ed5-9d82-b186e3bb48a0";
  const observationResponse = await serializedAction({ type: "OBSERVE_DOM", taskId, tabId: 19, mode: "interactive" });
  assert.equal(observationResponse.success, true);
  const observation = observationResponse.payload.observation;
  assert.equal(observation.elements[0].id, "el_1");
  assert.equal(observation.elements[0].name, "Continue");
  assert.match(observation.fingerprint, /^sha256-[a-f0-9]{64}$/);
  const call = { protocolVersion: 1, taskId, callId: "d9f6de2b-8d5b-4b9e-8af4-8589c53ac0e3", tool: "click_element", arguments: { observationId: observation.observationId, elementId: "el_1" }, reason: "Continue the fixture", expectedOutcome: "The button is clicked" };
  const clicked = await serializedAction({ type: "EXECUTE_TOOL", payload: call });
  assert.equal(clicked.success, true);
  assert.equal(clicked.payload.clicked, true);
  assert.equal(clickCount, 1);
  scrollListeners[0]();
  const staleAfterScroll = await serializedAction({ type: "EXECUTE_TOOL", payload: call });
  assert.equal(staleAfterScroll.success, false);
  assert.match(staleAfterScroll.error, /STALE_OBSERVATION/);

  const freshResponse = await serializedAction({ type: "OBSERVE_DOM", taskId, tabId: 19, mode: "interactive" });
  const freshObservation = freshResponse.payload.observation;
  const freshCall = { ...call, arguments: { observationId: freshObservation.observationId, elementId: "el_1" } };
  observers.at(-1).callback();
  const stale = await serializedAction({ type: "EXECUTE_TOOL", payload: freshCall });
  assert.equal(stale.success, false);
  assert.match(stale.error, /STALE_OBSERVATION/);
});

test("observation stays valid and truncated on pages exceeding 5,000 DOM nodes", async () => {
  class Button {
    tagName = "BUTTON";
    isConnected = true;
    disabled = false;
    innerText = "Action";
    textContent = "Action";
    getAttribute(name) { return name === "type" ? "button" : null; }
    hasAttribute() { return false; }
    getBoundingClientRect() { return { x: 5, y: 5, left: 5, top: 5, right: 85, bottom: 35, width: 80, height: 30 }; }
    matches() { return true; }
  }
  const buttons = Array.from({ length: 5001 }, () => new Button());
  const nodeList = { length: buttons.length, item: (index) => buttons[index] ?? null };
  class Observer { constructor() {} observe() {} disconnect() {} }
  const document = {
    title: "Large fixture", documentElement: { scrollHeight: 5000 }, body: { innerText: "Large page", contains: () => true }, activeElement: null,
    getElementById: () => null, querySelectorAll(selector) {
      if (selector === "*") return nodeList;
      if (selector.startsWith("button,a[href]")) return nodeList;
      return [];
    },
  };
  const window = { location: { href: "https://fixture.test/large" }, innerWidth: 800, innerHeight: 600, scrollX: 0, scrollY: 0, addEventListener() {}, removeEventListener() {}, getComputedStyle: () => ({ display: "block", visibility: "visible", opacity: "1" }) };
  const isolated = vm.createContext({
    window, document, crypto: globalThis.crypto, TextEncoder, MutationObserver: Observer, HTMLElement: Button, HTMLButtonElement: Button,
    HTMLAnchorElement: class {}, HTMLInputElement: class {}, HTMLTextAreaElement: class {}, HTMLSelectElement: class {}, HTMLImageElement: class {}, HTMLOptionElement: class {},
    innerWidth: 800, innerHeight: 600, performance, setTimeout, setInterval, clearTimeout, clearInterval, URL, Date, Math, JSON, Array, Number, String, Object, Map, Promise,
    InputEvent: class {}, Event: class {}, KeyboardEvent: class {},
  });
  const action = vm.runInContext(`(${runContentAction.toString()})`, isolated);
  const response = await action({ type: "OBSERVE_DOM", taskId: "5c193d5e-8210-4ed5-9d82-b186e3bb48a0", tabId: 3, mode: "interactive" });
  assert.equal(response.success, true);
  const observation = PageObservationSchema.parse(response.payload.observation);
  assert.equal(observation.truncated, true);
  assert.ok(observation.elementCount > 0);
  assert.ok(observation.elementCount < 5001);
  assert.match(observation.fingerprint, /^sha256-[a-f0-9]{64}$/);
});

test("rejects a snapshot if the page mutates while its fingerprint is being computed", async () => {
  let mutationCallback;
  class Observer { constructor(callback) { mutationCallback = callback; } observe() {} disconnect() {} }
  const document = { title: "Racing fixture", documentElement: { scrollHeight: 600 }, body: { innerText: "Fixture" }, activeElement: null, getElementById: () => null, querySelectorAll: () => [] };
  const window = { location: { href: "https://fixture.test/race" }, innerWidth: 800, innerHeight: 600, scrollX: 0, scrollY: 0, addEventListener() {}, removeEventListener() {}, getComputedStyle: () => ({ display: "block", visibility: "visible", opacity: "1" }) };
  const crypto = {
    randomUUID: () => "33333333-3333-4333-8333-333333333333",
    subtle: { async digest() { mutationCallback(); return new ArrayBuffer(32); } },
  };
  const isolated = vm.createContext({ window, document, crypto, TextEncoder, MutationObserver: Observer, HTMLElement: class {}, HTMLButtonElement: class {}, HTMLAnchorElement: class {}, HTMLInputElement: class {}, HTMLTextAreaElement: class {}, HTMLSelectElement: class {}, HTMLImageElement: class {}, HTMLOptionElement: class {}, innerWidth: 800, innerHeight: 600, performance, setTimeout, setInterval, clearTimeout, clearInterval, URL, Date, Math, JSON, Array, Number, String, Object, Map, Promise, InputEvent: class {}, Event: class {}, KeyboardEvent: class {} });
  const action = vm.runInContext(`(${runContentAction.toString()})`, isolated);
  const response = await action({ type: "OBSERVE_DOM", taskId: "5c193d5e-8210-4ed5-9d82-b186e3bb48a0", tabId: 4, mode: "compact" });
  assert.equal(response.success, false);
  assert.match(response.error, /page changed while its observation was being captured/);
});

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { ScriptInjector } from "../src/browser/ScriptInjector.ts";

const originalChrome = globalThis.chrome;
const originalWindow = globalThis.window;
const originalDocument = globalThis.document;

afterEach(() => {
  globalThis.chrome = originalChrome;
  globalThis.window = originalWindow;
  globalThis.document = originalDocument;
});

function installPage(text = "fixture page text") {
  globalThis.window = { location: { href: "https://fixture.test/page" } };
  globalThis.document = {
    title: "Fixture page",
    body: { innerText: text },
    querySelectorAll: () => ({ length: 7 }),
  };
}

function installInjectionMock() {
  const calls = [];
  globalThis.chrome = {
    scripting: {
      async executeScript(details) {
        calls.push(details);
        return [{ result: details.func(...(details.args ?? [])) }];
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

test("caps observed text and keeps tool execution disabled in the foundation", async () => {
  installPage("x".repeat(6000));
  installInjectionMock();
  const injector = new ScriptInjector();

  assert.equal((await injector.readVisibleText(19)).length, 5000);
  await assert.rejects(injector.sendContentAction(19, {
    type: "EXECUTE_TOOL",
    payload: {
      protocolVersion: "1.0",
      taskId: "5c193d5e-8210-4ed5-9d82-b186e3bb48a0",
      callId: "d9f6de2b-8d5b-4b9e-8af4-8589c53ac0e3",
      tool: "click",
      arguments: {},
      reason: "fixture",
      expectedOutcome: "fixture",
    },
  }), /not available in this phase/);
});

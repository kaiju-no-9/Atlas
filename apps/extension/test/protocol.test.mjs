import assert from "node:assert/strict";
import test from "node:test";
import { RuntimeMessageSchema } from "../../../packages/contracts/src/messages.ts";

test("accepts a message from the supported runtime protocol", () => {
  assert.equal(RuntimeMessageSchema.safeParse({ type: "GET_ACTIVE_TAB" }).success, true);
});

test("rejects empty and oversized task goals", () => {
  assert.equal(RuntimeMessageSchema.safeParse({ type: "START_TASK", goal: "   " }).success, false);
  assert.equal(RuntimeMessageSchema.safeParse({ type: "START_TASK", goal: "x".repeat(2001) }).success, false);
});

test("rejects task control actions outside the protocol", () => {
  assert.equal(RuntimeMessageSchema.safeParse({ type: "TASK_CONTROL", action: "delete" }).success, false);
});

test("bounds saved API keys and requires a non-empty model identifier", () => {
  const base = { type: "SAVE_SETTINGS", settings: {
    provider: "openrouter", apiKey: "", model: "openai/gpt-4o-mini", rememberKey: false, clearKey: false,
  } };
  assert.equal(RuntimeMessageSchema.safeParse(base).success, true);
  assert.equal(RuntimeMessageSchema.safeParse({ ...base, settings: { ...base.settings, model: " " } }).success, false);
  assert.equal(RuntimeMessageSchema.safeParse({ ...base, settings: { ...base.settings, apiKey: "x".repeat(501) } }).success, false);
});

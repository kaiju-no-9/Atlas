import assert from "node:assert/strict";
import test from "node:test";
import { ensureRecoveryAlarm, RECOVERY_ALARM_NAME } from "../src/shared/recoveryAlarm.ts";

test("creates the recovery alarm when Chrome has no persisted alarm", async () => {
  const created = [];
  globalThis.chrome = {
    alarms: {
      async get(name) { assert.equal(name, RECOVERY_ALARM_NAME); return undefined; },
      async create(name, options) { created.push({ name, options }); },
    },
  };

  await ensureRecoveryAlarm();

  assert.deepEqual(created, [{ name: RECOVERY_ALARM_NAME, options: { periodInMinutes: 1 } }]);
});

test("keeps an existing recovery alarm instead of resetting its schedule", async () => {
  let createCalled = false;
  globalThis.chrome = {
    alarms: {
      async get() { return { name: RECOVERY_ALARM_NAME, periodInMinutes: 1 }; },
      async create() { createCalled = true; },
    },
  };

  await ensureRecoveryAlarm();

  assert.equal(createCalled, false);
});

export const RECOVERY_ALARM_NAME = "atlas_task_recovery_heartbeat";

/** Recreate the periodic alarm when Chrome clears alarms during browser startup. */
export async function ensureRecoveryAlarm(): Promise<void> {
  const existing = await chrome.alarms.get(RECOVERY_ALARM_NAME);
  if (!existing) {
    await chrome.alarms.create(RECOVERY_ALARM_NAME, { periodInMinutes: 1 });
  }
}

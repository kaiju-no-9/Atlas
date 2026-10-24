import { PageObservationSchema, type PageObservation } from "../perception/types.ts";
import { TaskSpecSchema, type TaskSpec } from "./types.ts";
import { TaskSnapshotSchema, type TaskSnapshot } from "./states.ts";
import { WriteQueue } from "../storage/WriteQueue.ts";
import { ToolResultEnvelopeSchema, type ToolResultEnvelope } from "../tools/protocol.ts";

const PREFIX = "atlas_agent_task_";
const snapshotKey = (taskId: string) => `${PREFIX}${taskId}_snapshot`;
const specKey = (taskId: string) => `${PREFIX}${taskId}_spec`;
const observationKey = (taskId: string, observationId: string) => `${PREFIX}${taskId}_observation_${observationId}`;
const resultKey = (taskId: string) => `${PREFIX}${taskId}_results`;
function parseResults(raw: unknown): ToolResultEnvelope[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item: unknown) => {
    const parsed = ToolResultEnvelopeSchema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
}

/** Trusted-context repository for crash-safe controller checkpoints and observations. */
export class TaskRepository {
  private readonly writes = new WriteQueue();

  async create(taskId: string, activeTabId: number, spec: TaskSpec): Promise<TaskSnapshot> {
    const parsedSpec = TaskSpecSchema.parse(spec);
    if (parsedSpec.id !== taskId) throw new Error("Task spec ID does not match the requested task.");
    const now = new Date().toISOString();
    const snapshot = TaskSnapshotSchema.parse({
      taskId, state: "AwaitingPlanApproval", stepCount: 0, activeTabId,
      budgetsUsed: { steps: 0, tokens: 0, startTime: Date.now() },
      recoveryAttemptsForCurrentStep: 0, consecutiveNoProgressSteps: 0, revision: 0, updatedAt: now,
    });
    await chrome.storage.local.set({ [specKey(taskId)]: parsedSpec, [snapshotKey(taskId)]: snapshot });
    return snapshot;
  }

  async getTaskSpec(taskId: string): Promise<TaskSpec> {
    const key = specKey(taskId);
    const stored = await chrome.storage.local.get(key);
    const parsed = TaskSpecSchema.safeParse(stored[key]);
    if (!parsed.success) throw new Error("The persisted task specification is missing or invalid.");
    return parsed.data;
  }

  async saveTaskSpec(input: TaskSpec): Promise<TaskSpec> {
    const spec = TaskSpecSchema.parse(input);
    await chrome.storage.local.set({ [specKey(spec.id)]: spec });
    return spec;
  }

  async getTaskSnapshot(taskId: string): Promise<TaskSnapshot | undefined> {
    const key = snapshotKey(taskId);
    const stored = await chrome.storage.local.get(key);
    const parsed = TaskSnapshotSchema.safeParse(stored[key]);
    return parsed.success ? parsed.data : undefined;
  }

  async saveTaskSnapshot(input: TaskSnapshot): Promise<TaskSnapshot> {
    const snapshot = TaskSnapshotSchema.parse(input);
    const key = snapshotKey(snapshot.taskId);
    return this.writes.run(key, async () => {
      const previous = await this.getTaskSnapshot(snapshot.taskId);
      const next = TaskSnapshotSchema.parse({ ...snapshot, revision: Math.max(snapshot.revision, (previous?.revision ?? -1) + 1), updatedAt: new Date().toISOString() });
      await chrome.storage.local.set({ [key]: next });
      return next;
    });
  }

  async saveObservation(observation: PageObservation): Promise<void> {
    const parsed = PageObservationSchema.parse(observation);
    await chrome.storage.local.set({ [observationKey(parsed.taskId, parsed.observationId)]: parsed });
  }

  async getObservation(taskId: string, observationId: string): Promise<PageObservation | undefined> {
    const key = observationKey(taskId, observationId);
    const stored = await chrome.storage.local.get(key);
    const parsed = PageObservationSchema.safeParse(stored[key]);
    return parsed.success ? parsed.data : undefined;
  }

  async saveToolResult(input: ToolResultEnvelope): Promise<void> {
    const result = ToolResultEnvelopeSchema.parse(input);
    const key = resultKey(result.taskId);
    await this.writes.run(key, async () => {
      const stored = await chrome.storage.local.get(key);
      const valid = parseResults(stored[key]);
      const next = [...valid.filter((item) => item.callId !== result.callId), result].slice(-500);
      await chrome.storage.local.set({ [key]: next });
    });
  }

  async getToolResults(taskId: string): Promise<ToolResultEnvelope[]> {
    const key = resultKey(taskId);
    const stored = await chrome.storage.local.get(key);
    return parseResults(stored[key]);
  }
}

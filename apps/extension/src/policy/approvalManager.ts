import type { ToolEnvelope } from "../tools/protocol.ts";

export const APPROVAL_REQUEST_TTL_MS = 30_000;
export const APPROVAL_TOKEN_TTL_MS = 15_000;

export interface ApprovalBinding {
  taskId: string;
  envelope: ToolEnvelope;
  targetUrl: string;
  observationFingerprint: string;
}

/** Produces a deterministic digest for a one-action approval bound to the observed page state. */
export async function approvalDigest(binding: ApprovalBinding): Promise<string> {
  const canonical = JSON.stringify({
    taskId: binding.taskId,
    tool: binding.envelope.tool,
    arguments: binding.envelope.arguments,
    targetUrl: binding.targetUrl,
    observationFingerprint: binding.observationFingerprint,
  });
  const bytes = new TextEncoder().encode(canonical);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function createApprovalNonce(): string { return crypto.randomUUID(); }

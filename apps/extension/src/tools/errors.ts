export type ErrorCategory = "PERCEPTION" | "EXECUTION" | "POLICY" | "NAVIGATION" | "PROTOCOL" | "SYSTEM";
export interface ToolErrorDetails {
  category: ErrorCategory; code: string; message: string; retryable: boolean;
  suggestedAction: "reobserve" | "wait_and_retry" | "abort_task" | "request_user_intervention";
}
export const AtlasErrorMap: Record<string, ToolErrorDetails> = {
  STALE_OBSERVATION: { category: "PERCEPTION", code: "STALE_OBSERVATION", message: "The observation is no longer current.", retryable: true, suggestedAction: "reobserve" },
  ELEMENT_DETACHED: { category: "PERCEPTION", code: "ELEMENT_DETACHED", message: "The target has left the page.", retryable: true, suggestedAction: "reobserve" },
  ELEMENT_OBSCURED: { category: "EXECUTION", code: "ELEMENT_OBSCURED", message: "Another element covers the target.", retryable: true, suggestedAction: "reobserve" },
  ACTION_TIMEOUT: { category: "SYSTEM", code: "ACTION_TIMEOUT", message: "The tab action exceeded its time limit.", retryable: true, suggestedAction: "wait_and_retry" },
  POLICY_VIOLATION: { category: "POLICY", code: "POLICY_VIOLATION", message: "The action is outside the approved policy.", retryable: false, suggestedAction: "request_user_intervention" },
  TAB_CRASHED_OR_CLOSED: { category: "NAVIGATION", code: "TAB_CRASHED_OR_CLOSED", message: "The target tab is no longer available.", retryable: false, suggestedAction: "abort_task" },
};

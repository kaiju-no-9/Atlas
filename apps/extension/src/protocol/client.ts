import { RuntimeResponseSchema, type RuntimeMessage } from "@atlas/contracts";

export async function sendMessage(message: RuntimeMessage): Promise<unknown> {
  const response = RuntimeResponseSchema.parse(await chrome.runtime.sendMessage(message));
  if (!response.success) throw new Error(response.error ?? "The extension request failed.");
  return response.data;
}

import { z } from "zod";

export const SettingsSchema = z.object({
  schemaVersion: z.literal(1),
  provider: z.enum(["openrouter", "openai", "anthropic"]),
  model: z.string().min(1).max(200),
  rememberKey: z.boolean(),
  apiKey: z.string().max(500),
  updatedAt: z.string().datetime(),
});
export type SettingsRecord = z.infer<typeof SettingsSchema>;

export const ChatRecordSchema = z.object({
  schemaVersion: z.literal(1),
  chatId: z.string().uuid(),
  task: z.object({
    taskId: z.string().uuid(),
    goal: z.string().min(1).max(2000),
    status: z.enum(["draft", "running", "paused", "completed", "failed", "cancelled"]),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  }),
  events: z.array(z.object({
    id: z.string().uuid(),
    type: z.enum(["user", "system", "status"]),
    text: z.string().max(4000),
    createdAt: z.string().datetime(),
  })).max(500),
});
export type ChatRecord = z.infer<typeof ChatRecordSchema>;

export const ChatIndexSchema = z.array(z.object({
  chatId: z.string().uuid(),
  title: z.string().max(120),
  updatedAt: z.string().datetime(),
})).max(100);
export type ChatIndexRecord = z.infer<typeof ChatIndexSchema>;

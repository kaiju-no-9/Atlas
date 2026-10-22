import { z } from "zod";

export const InteractiveElementSchema = z.object({
  id: z.string().regex(/^atlas-e-\d+$/),
  tagName: z.string(),
  role: z.string().nullable(),
  name: z.string().nullable(),
  text: z.string().max(500),
  value: z.string().nullable(),
  inputType: z.string().nullable(),
  attributes: z.record(z.string()),
  boundingBox: z.object({
    x: z.number(), y: z.number(), width: z.number(), height: z.number(), visible: z.boolean(),
  }),
  isClickable: z.boolean(),
  isDisabled: z.boolean(),
  isFocused: z.boolean(),
});
export type InteractiveElement = z.infer<typeof InteractiveElementSchema>;

export const ObservationSchema = z.object({
  observationId: z.string().uuid(),
  tabId: z.number().int(),
  url: z.string().url(),
  title: z.string(),
  capturedAt: z.string().datetime(),
  viewport: z.object({ width: z.number(), height: z.number(), scrollX: z.number(), scrollY: z.number() }),
  elements: z.array(InteractiveElementSchema),
  rawTextSummary: z.string().max(25_000),
  truncated: z.boolean(),
  confidence: z.number().min(0).max(1),
});
export type Observation = z.infer<typeof ObservationSchema>;

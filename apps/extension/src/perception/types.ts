import { z } from "zod";

export const ObservationModeSchema = z.enum(["compact", "interactive", "full_limited"]);
export type ObservationMode = z.infer<typeof ObservationModeSchema>;

export const BoundingBoxSchema = z.object({
  x: z.number().finite(), y: z.number().finite(), width: z.number().nonnegative(), height: z.number().nonnegative(),
  top: z.number().finite(), left: z.number().finite(),
});
export type BoundingBox = z.infer<typeof BoundingBoxSchema>;

export const ObservedElementSchema = z.object({
  id: z.string().regex(/^el_[1-9]\d*$/), tagName: z.string(), role: z.string(), name: z.string(),
  value: z.string().optional(), placeholder: z.string().optional(), disabled: z.boolean(), readOnly: z.boolean().optional(),
  checked: z.boolean().optional(), selected: z.boolean().optional(), visible: z.boolean(), inViewport: z.boolean(),
  bounds: BoundingBoxSchema, href: z.string().url().optional(), type: z.string().optional(),
  ariaExpanded: z.boolean().optional(), ariaRequired: z.boolean().optional(),
});
export type ObservedElement = z.infer<typeof ObservedElementSchema>;

export const PageObservationSchema = z.object({
  observationId: z.string().uuid(), taskId: z.string().uuid(), tabId: z.number().int().nonnegative(),
  url: z.string().url(), title: z.string(), mode: ObservationModeSchema, capturedAt: z.string().datetime(),
  viewport: z.object({ width: z.number().nonnegative(), height: z.number().nonnegative(), scrollX: z.number(), scrollY: z.number(), totalHeight: z.number().nonnegative() }),
  fingerprint: z.string().min(1), headings: z.array(z.object({ level: z.number().int().min(1).max(6), text: z.string() })),
  landmarks: z.array(z.object({ role: z.string(), name: z.string().optional() })),
  elements: z.array(ObservedElementSchema), truncated: z.boolean(), elementCount: z.number().int().nonnegative(),
});
export type PageObservation = z.infer<typeof PageObservationSchema>;

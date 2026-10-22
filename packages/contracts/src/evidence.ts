import { z } from "zod";

export const EvidenceSnippetSchema = z.object({
  claim: z.string(), exactTextQuote: z.string(), domSelector: z.string().optional(),
  confidence: z.number().min(0).max(1),
});
export type EvidenceSnippet = z.infer<typeof EvidenceSnippetSchema>;

export const EvidenceRecordSchema = z.object({
  sourceId: z.string().uuid(), taskId: z.string().uuid(), url: z.string().url(),
  title: z.string(), retrievedAt: z.string().datetime(),
  contentMethod: z.enum(["dom_tree", "readability", "screenshot_ocr"]),
  sectionsRead: z.array(z.string()), evidence: z.array(EvidenceSnippetSchema),
  httpStatus: z.number().int().default(200),
});
export type EvidenceRecord = z.infer<typeof EvidenceRecordSchema>;

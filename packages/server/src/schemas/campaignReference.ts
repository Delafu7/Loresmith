import { z } from 'zod';

// GET/PUT /campaigns/:id/reference-notes (Iteration 4) — a DM-only
// freeform scratchpad, distinct from notes.ts's campaign-wide notes.
export const updateReferenceNotesSchema = z.object({
  body: z.string().max(20000),
});
export type UpdateReferenceNotesInput = z.infer<typeof updateReferenceNotesSchema>;

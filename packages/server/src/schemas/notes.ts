import { z } from 'zod';

export const createNoteSchema = z.object({
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(50000),
  sessionId: z.number().int().positive().optional().nullable(),
  characterId: z.number().int().positive().optional().nullable(),
});
export type CreateNoteInput = z.infer<typeof createNoteSchema>;

export const updateNoteSchema = createNoteSchema.partial();
export type UpdateNoteInput = z.infer<typeof updateNoteSchema>;

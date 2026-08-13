import { z } from 'zod';

export const createNoteSchema = z.object({
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(50000),
  sessionId: z.string().uuid().optional().nullable(),
  characterId: z.string().uuid().optional().nullable(),
  // Phase 3 "rulings log" — omitted defaults to 'note' at the DB level
  // (notes.note_type's own DEFAULT), same "no .default() here" convention
  // as every other field in this shape.
  noteType: z.enum(['note', 'ruling']).optional(),
  // Phase 3 "locations and factions".
  locationId: z.string().uuid().optional().nullable(),
  // GM-only visibility layer — omitted defaults at the service layer to
  // 'gm_only' for a DM-authored note or 'revealed_to_players' for a
  // player-authored one (see services/notes.ts's createNote), not a flat
  // .default() here, since the right default depends on the actor's role.
  visibility: z.enum(['gm_only', 'revealed_to_players', 'owner_only']).optional(),
});
export type CreateNoteInput = z.infer<typeof createNoteSchema>;

export const updateNoteSchema = createNoteSchema.partial();
export type UpdateNoteInput = z.infer<typeof updateNoteSchema>;

// Phase 3 "full-text search on notes".
export const searchNotesQuerySchema = z.object({
  q: z.string().min(1).max(200),
});
export type SearchNotesQuery = z.infer<typeof searchNotesQuerySchema>;

// GM-only visibility layer — bulk reveal/hide for the notes page's
// multi-select bar, DM-only (see routes/notes.ts).
export const batchSetNotesVisibilitySchema = z.object({
  noteIds: z.array(z.string().uuid()).min(1),
  visibility: z.enum(['gm_only', 'revealed_to_players', 'owner_only']),
});
export type BatchSetNotesVisibilityInput = z.infer<typeof batchSetNotesVisibilitySchema>;

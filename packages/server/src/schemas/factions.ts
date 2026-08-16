import { z } from 'zod';

export const createFactionSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(20000).optional().nullable(),
  notes: z.string().max(20000).optional().nullable(),
});
export type CreateFactionInput = z.infer<typeof createFactionSchema>;

// DM-only hide/reveal toggle — see schemas/locations.ts's identical field
// for why this isn't part of createFactionSchema.
export const updateFactionSchema = createFactionSchema.partial().extend({
  visibleToPlayers: z.boolean().optional(),
});
export type UpdateFactionInput = z.infer<typeof updateFactionSchema>;

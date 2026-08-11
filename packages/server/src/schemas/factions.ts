import { z } from 'zod';

export const createFactionSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(20000).optional().nullable(),
  notes: z.string().max(20000).optional().nullable(),
});
export type CreateFactionInput = z.infer<typeof createFactionSchema>;

export const updateFactionSchema = createFactionSchema.partial();
export type UpdateFactionInput = z.infer<typeof updateFactionSchema>;

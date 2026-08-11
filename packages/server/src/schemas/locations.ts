import { z } from 'zod';

export const createLocationSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(20000).optional().nullable(),
  notes: z.string().max(20000).optional().nullable(),
});
export type CreateLocationInput = z.infer<typeof createLocationSchema>;

export const updateLocationSchema = createLocationSchema.partial();
export type UpdateLocationInput = z.infer<typeof updateLocationSchema>;

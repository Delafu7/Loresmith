import { z } from 'zod';

export const createCharacterFeatSchema = z.object({
  featId: z.string().uuid(),
});
export type CreateCharacterFeatInput = z.infer<typeof createCharacterFeatSchema>;

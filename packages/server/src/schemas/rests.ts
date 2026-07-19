import { z } from 'zod';

export const restSchema = z.object({
  restType: z.enum(['short', 'long']),
  characterIds: z.array(z.number().int().positive()).min(1),
});
export type RestInput = z.infer<typeof restSchema>;

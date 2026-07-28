import { z } from 'zod';

export const restSchema = z.object({
  restType: z.enum(['short', 'long']),
  characterIds: z.array(z.string().uuid()).min(1),
});
export type RestInput = z.infer<typeof restSchema>;

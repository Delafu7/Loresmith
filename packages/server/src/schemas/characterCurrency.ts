import { z } from 'zod';

export const updateCharacterCurrencySchema = z.object({
  cp: z.number().int().min(0).optional(),
  sp: z.number().int().min(0).optional(),
  ep: z.number().int().min(0).optional(),
  gp: z.number().int().min(0).optional(),
  pp: z.number().int().min(0).optional(),
});
export type UpdateCharacterCurrencyInput = z.infer<typeof updateCharacterCurrencySchema>;

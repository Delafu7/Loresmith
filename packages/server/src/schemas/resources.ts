import { z } from 'zod';

export const resourceAmountSchema = z.object({
  amount: z.number().int().positive(),
});
export type ResourceAmountInput = z.infer<typeof resourceAmountSchema>;

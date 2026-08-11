import { z } from 'zod';

export const createCampaignEventSchema = z.object({
  inGameDay: z.number().int(),
  title: z.string().min(1).max(200),
  description: z.string().max(20000).optional().nullable(),
});
export type CreateCampaignEventInput = z.infer<typeof createCampaignEventSchema>;

export const updateCampaignEventSchema = createCampaignEventSchema.partial();
export type UpdateCampaignEventInput = z.infer<typeof updateCampaignEventSchema>;

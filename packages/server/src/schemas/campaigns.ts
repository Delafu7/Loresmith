import { z } from 'zod';

export const srdEditionEnum = z.enum(['2014', '2024']);

export const createCampaignSchema = z.object({
  name: z.string().min(1).max(200),
  srdEdition: srdEditionEnum,
  description: z.string().max(5000).optional().nullable(),
});
export type CreateCampaignInput = z.infer<typeof createCampaignSchema>;

export const updateCampaignSchema = createCampaignSchema.partial().extend({
  archived: z.boolean().optional(), // true -> set archived_at = now(); false -> clear it
  // Ability Score Roll feature (Phase 3.8): DM-togglable, whether players may
  // re-roll their 4d6-drop-lowest set after seeing the results. See
  // routes/campaigns.ts's /roll-ability-scores for the roll itself.
  allowAbilityReroll: z.boolean().optional(),
});
export type UpdateCampaignInput = z.infer<typeof updateCampaignSchema>;

export const campaignRoleEnum = z.enum(['dm', 'player']);

export const addMemberSchema = z.object({
  email: z.string().email(),
  role: campaignRoleEnum,
});
export type AddMemberInput = z.infer<typeof addMemberSchema>;

export const updateMemberSchema = z.object({
  role: campaignRoleEnum,
});
export type UpdateMemberInput = z.infer<typeof updateMemberSchema>;

export const createSessionLogSchema = z.object({
  sessionNumber: z.number().int().positive(),
  title: z.string().max(200).optional().nullable(),
  playedAt: z.string().date().optional().nullable(), // 'YYYY-MM-DD'
  recap: z.string().max(20000).optional().nullable(),
});
export type CreateSessionLogInput = z.infer<typeof createSessionLogSchema>;

export const updateSessionLogSchema = createSessionLogSchema.partial();
export type UpdateSessionLogInput = z.infer<typeof updateSessionLogSchema>;

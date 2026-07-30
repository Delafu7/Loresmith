import { z } from 'zod';
import { campaignRoleEnum } from './campaigns.js';

export const createInvitationSchema = z.object({
  email: z.string().email(),
  role: campaignRoleEnum,
});
export type CreateInvitationInput = z.infer<typeof createInvitationSchema>;

import { z } from 'zod';
import { campaignRoleEnum } from './campaigns.js';

// Iteration 2 "Character ownership vs. control" — characterId turns a plain
// membership invite into "invite this person to claim this specific
// pre-built character" (services/campaignInvitations.ts's createInvitation
// validates it's an unclaimed PC belonging to this campaign; acceptInvitation
// assigns ownership in the same transaction as granting membership).
export const createInvitationSchema = z.object({
  email: z.string().email(),
  role: campaignRoleEnum,
  characterId: z.string().uuid().optional(),
});
export type CreateInvitationInput = z.infer<typeof createInvitationSchema>;

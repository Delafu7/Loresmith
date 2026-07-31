import { z } from 'zod';

// A campaign-stash row (character_items with campaign_id set, character_id/
// monster_instance_id both null — see the add-campaign-item-stash migration)
// has no equip/attunement state, since nobody owns it yet; those fields only
// apply once giveCampaignStashItemToCharacter moves the row onto a character.
const sharedStashItemShape = {
  itemId: z.string().uuid(),
  quantity: z.number().int().min(0),
  customName: z.string().max(200).optional().nullable(),
  chargesRemaining: z.number().int().min(0).optional().nullable(),
  notes: z.string().max(5000).optional().nullable(),
};

export const importCampaignStashItemSchema = z.object(sharedStashItemShape).extend({
  quantity: z.number().int().min(1).default(1),
});
export type ImportCampaignStashItemInput = z.infer<typeof importCampaignStashItemSchema>;

export const updateCampaignStashItemSchema = z.object(sharedStashItemShape).omit({ itemId: true }).partial();
export type UpdateCampaignStashItemInput = z.infer<typeof updateCampaignStashItemSchema>;

export const giveStashItemToCharacterSchema = z.object({
  characterId: z.string().uuid(),
});
export type GiveStashItemToCharacterInput = z.infer<typeof giveStashItemToCharacterSchema>;

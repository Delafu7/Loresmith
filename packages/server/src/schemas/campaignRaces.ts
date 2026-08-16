import { z } from 'zod';
import { raceHomebrewShape } from './catalogHomebrew.js';

// Campaign race curation — add/edit/remove a reference to a catalog race
// within one campaign. Mirrors schemas/campaignBestiary.ts's shape exactly.

export const addToCampaignRacesSchema = z.object({
  raceIds: z.array(z.string().uuid()).min(1).max(200),
});
export type AddToCampaignRacesInput = z.infer<typeof addToCampaignRacesSchema>;

export const removeFromCampaignRacesSchema = z.object({
  entryIds: z.array(z.string().uuid()).min(1).max(200),
});
export type RemoveFromCampaignRacesInput = z.infer<typeof removeFromCampaignRacesSchema>;

// overrides reuses raceHomebrewShape wholesale (already every races column),
// same "stay in sync automatically as the race schema evolves" reasoning as
// campaignBestiary's statOverrides reusing updateHomebrewMonsterSchema.
export const updateCampaignRaceEntrySchema = z.object({
  customName: z.string().max(200).optional().nullable(),
  overrides: z.object(raceHomebrewShape).partial().optional(),
  clearOverrides: z.array(z.string().max(100)).max(30).optional(),
  notes: z.string().max(20000).optional().nullable(),
});
export type UpdateCampaignRaceEntryInput = z.infer<typeof updateCampaignRaceEntrySchema>;

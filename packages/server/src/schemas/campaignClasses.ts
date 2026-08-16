import { z } from 'zod';
import { classHomebrewShape } from './catalogHomebrew.js';

// Campaign class curation — add/edit/remove a reference to a catalog class
// within one campaign. Mirrors schemas/campaignBestiary.ts's shape exactly.

export const addToCampaignClassesSchema = z.object({
  classIds: z.array(z.string().uuid()).min(1).max(200),
});
export type AddToCampaignClassesInput = z.infer<typeof addToCampaignClassesSchema>;

export const removeFromCampaignClassesSchema = z.object({
  entryIds: z.array(z.string().uuid()).min(1).max(200),
});
export type RemoveFromCampaignClassesInput = z.infer<typeof removeFromCampaignClassesSchema>;

// overrides reuses classHomebrewShape wholesale, same reasoning as
// schemas/campaignRaces.ts's overrides field.
export const updateCampaignClassEntrySchema = z.object({
  customName: z.string().max(200).optional().nullable(),
  overrides: z.object(classHomebrewShape).partial().optional(),
  clearOverrides: z.array(z.string().max(100)).max(30).optional(),
  notes: z.string().max(20000).optional().nullable(),
});
export type UpdateCampaignClassEntryInput = z.infer<typeof updateCampaignClassEntrySchema>;

// Mounted at /campaigns/:id/reference-notes (Iteration 4). Both GET and PUT
// are DM-only per the migration's own "always-GM-only resource" design —
// unlike routes/notes.ts, there's no player-readable branch here at all.
import { Router } from 'express';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { requireCampaignMember, requireRole } from '../middleware/campaign.js';
import { updateReferenceNotesSchema } from '../schemas/campaignReference.js';
import * as campaignReferenceService from '../services/campaignReference.js';

export const campaignReferenceRouter = Router({ mergeParams: true });
campaignReferenceRouter.use(requireAuth, requireCampaignMember(), requireRole('dm'));

campaignReferenceRouter.get('/', async (req, res) => {
  const notes = await campaignReferenceService.getReferenceNotes(pool, req.campaignId!);
  res.json({ notes });
});

campaignReferenceRouter.put('/', async (req, res) => {
  const input = updateReferenceNotesSchema.parse(req.body);
  const notes = await campaignReferenceService.updateReferenceNotes(pool, req.campaignId!, input.body);
  res.json({ notes });
});

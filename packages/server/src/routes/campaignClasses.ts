// Mounted at /campaigns/:id/classes. Mirrors routes/campaignRaces.ts exactly,
// swapped to the classes catalog/service.
import { Router } from 'express';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { requireCampaignMember, requireRole } from '../middleware/campaign.js';
import { addToCampaignClassesSchema, removeFromCampaignClassesSchema, updateCampaignClassEntrySchema } from '../schemas/campaignClasses.js';
import * as campaignClassesService from '../services/campaignClasses.js';

export const campaignClassesRouter = Router({ mergeParams: true });
campaignClassesRouter.use(requireAuth, requireCampaignMember());

campaignClassesRouter.get('/', async (req, res) => {
  const entries = await campaignClassesService.listCampaignClasses(pool, req.campaignId!);
  res.json({ entries });
});

campaignClassesRouter.post('/', requireRole('dm'), async (req, res) => {
  const input = addToCampaignClassesSchema.parse(req.body);
  const result = await campaignClassesService.addToCampaignClasses(pool, req.campaignId!, req.user!.id, input.classIds);
  res.status(201).json(result);
});

campaignClassesRouter.post('/bulk-remove', requireRole('dm'), async (req, res) => {
  const input = removeFromCampaignClassesSchema.parse(req.body);
  const result = await campaignClassesService.removeCampaignClassEntries(pool, req.campaignId!, input.entryIds);
  res.json(result);
});

campaignClassesRouter.get('/:entryId', async (req, res) => {
  const entry = await campaignClassesService.getCampaignClassEntry(pool, req.campaignId!, req.params.entryId as string);
  res.json({ entry });
});

campaignClassesRouter.patch('/:entryId', requireRole('dm'), async (req, res) => {
  const input = updateCampaignClassEntrySchema.parse(req.body);
  const entry = await campaignClassesService.updateCampaignClassEntry(pool, req.campaignId!, req.params.entryId as string, input);
  res.json({ entry });
});

campaignClassesRouter.delete('/:entryId', requireRole('dm'), async (req, res) => {
  await campaignClassesService.removeCampaignClassEntry(pool, req.campaignId!, req.params.entryId as string);
  res.status(204).send();
});

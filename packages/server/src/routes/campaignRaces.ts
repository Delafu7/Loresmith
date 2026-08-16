// Mounted at /campaigns/:id/races. Structurally mirrors routes/
// campaignBestiary.ts's campaignBestiaryRouter: Router({ mergeParams: true }),
// requireAuth + requireCampaignMember() on the whole router, requireRole('dm')
// added per-route for writes. Any campaign member can browse; only the DM can
// import/edit/remove — same posture as the bestiary and item stash.
import { Router } from 'express';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { requireCampaignMember, requireRole } from '../middleware/campaign.js';
import { addToCampaignRacesSchema, removeFromCampaignRacesSchema, updateCampaignRaceEntrySchema } from '../schemas/campaignRaces.js';
import * as campaignRacesService from '../services/campaignRaces.js';

export const campaignRacesRouter = Router({ mergeParams: true });
campaignRacesRouter.use(requireAuth, requireCampaignMember());

campaignRacesRouter.get('/', async (req, res) => {
  const entries = await campaignRacesService.listCampaignRaces(pool, req.campaignId!);
  res.json({ entries });
});

campaignRacesRouter.post('/', requireRole('dm'), async (req, res) => {
  const input = addToCampaignRacesSchema.parse(req.body);
  const result = await campaignRacesService.addToCampaignRaces(pool, req.campaignId!, req.user!.id, input.raceIds);
  res.status(201).json(result);
});

// Bulk remove — POST-as-action, mounted before /:entryId so Express doesn't
// try to match the literal path "bulk-remove" against that param route. Same
// convention as campaignBestiaryRouter's own bulk-remove route.
campaignRacesRouter.post('/bulk-remove', requireRole('dm'), async (req, res) => {
  const input = removeFromCampaignRacesSchema.parse(req.body);
  const result = await campaignRacesService.removeCampaignRaceEntries(pool, req.campaignId!, input.entryIds);
  res.json(result);
});

campaignRacesRouter.get('/:entryId', async (req, res) => {
  const entry = await campaignRacesService.getCampaignRaceEntry(pool, req.campaignId!, req.params.entryId as string);
  res.json({ entry });
});

campaignRacesRouter.patch('/:entryId', requireRole('dm'), async (req, res) => {
  const input = updateCampaignRaceEntrySchema.parse(req.body);
  const entry = await campaignRacesService.updateCampaignRaceEntry(pool, req.campaignId!, req.params.entryId as string, input);
  res.json({ entry });
});

campaignRacesRouter.delete('/:entryId', requireRole('dm'), async (req, res) => {
  await campaignRacesService.removeCampaignRaceEntry(pool, req.campaignId!, req.params.entryId as string);
  res.status(204).send();
});

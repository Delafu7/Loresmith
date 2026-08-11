import { Router } from 'express';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { requireCampaignMember, requireRole } from '../middleware/campaign.js';
import { createFactionSchema, updateFactionSchema } from '../schemas/factions.js';
import * as factionsService from '../services/factions.js';

// Mounted at /campaigns/:id/factions
export const factionsRouter = Router({ mergeParams: true });
factionsRouter.use(requireAuth, requireCampaignMember());

factionsRouter.get('/', async (req, res) => {
  const factions = await factionsService.listFactions(pool, req.campaignId!);
  res.json({ factions });
});

factionsRouter.post('/', requireRole('dm'), async (req, res) => {
  const input = createFactionSchema.parse(req.body);
  const faction = await factionsService.createFaction(pool, req.campaignId!, req.campaignRole!, input);
  res.status(201).json({ faction });
});

factionsRouter.patch('/:factionId', requireRole('dm'), async (req, res) => {
  const input = updateFactionSchema.parse(req.body);
  const faction = await factionsService.updateFaction(
    pool, req.campaignId!, (req.params.factionId as string), req.campaignRole!, input,
  );
  res.json({ faction });
});

factionsRouter.delete('/:factionId', requireRole('dm'), async (req, res) => {
  await factionsService.deleteFaction(pool, req.campaignId!, (req.params.factionId as string), req.campaignRole!);
  res.status(204).send();
});

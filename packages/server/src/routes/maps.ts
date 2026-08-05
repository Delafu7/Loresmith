// Mounted at /campaigns/:id/maps — the campaign-scoped map library
// (1784269788666_create-campaign-maps-library.ts). Structurally mirrors
// routes/campaignBestiary.ts: Router({ mergeParams: true }),
// requireAuth + requireCampaignMember() on the whole router. Unlike the
// bestiary, gated to DM for READS too, not just writes — `notes` may hold
// GM prep text, and there's no per-entry discovery/reveal flag here the
// way campaign_bestiary_entries has for players.
//
// The encounter-scoped link/unlink/activate actions live in
// routes/encounters.ts's flat encountersRouter instead (same file as every
// other per-encounter action route, e.g. /mode, /disposition), not here.
import { Router } from 'express';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { requireCampaignMember, requireRole } from '../middleware/campaign.js';
import { createMapSchema, updateMapSchema } from '../schemas/maps.js';
import * as mapsService from '../services/maps.js';

export const campaignMapsRouter = Router({ mergeParams: true });
campaignMapsRouter.use(requireAuth, requireCampaignMember(), requireRole('dm'));

campaignMapsRouter.get('/', async (req, res) => {
  const maps = await mapsService.listMaps(pool, req.campaignId!);
  res.json({ maps });
});

campaignMapsRouter.post('/', async (req, res) => {
  const input = createMapSchema.parse(req.body);
  const map = await mapsService.createMap(pool, req.campaignId!, input);
  res.status(201).json({ map });
});

campaignMapsRouter.get('/:mapId', async (req, res) => {
  const map = await mapsService.getMap(pool, req.campaignId!, req.params.mapId as string);
  res.json({ map });
});

campaignMapsRouter.patch('/:mapId', async (req, res) => {
  const input = updateMapSchema.parse(req.body);
  const map = await mapsService.updateMap(pool, req.campaignId!, req.params.mapId as string, input);
  res.json({ map });
});

campaignMapsRouter.delete('/:mapId', async (req, res) => {
  await mapsService.deleteMap(pool, req.campaignId!, req.params.mapId as string);
  res.status(204).send();
});

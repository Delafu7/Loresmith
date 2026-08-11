import { Router } from 'express';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { requireCampaignMember, requireRole } from '../middleware/campaign.js';
import { createLocationSchema, updateLocationSchema } from '../schemas/locations.js';
import * as locationsService from '../services/locations.js';

// Mounted at /campaigns/:id/locations
export const locationsRouter = Router({ mergeParams: true });
locationsRouter.use(requireAuth, requireCampaignMember());

locationsRouter.get('/', async (req, res) => {
  const locations = await locationsService.listLocations(pool, req.campaignId!);
  res.json({ locations });
});

locationsRouter.post('/', requireRole('dm'), async (req, res) => {
  const input = createLocationSchema.parse(req.body);
  const location = await locationsService.createLocation(pool, req.campaignId!, req.campaignRole!, input);
  res.status(201).json({ location });
});

locationsRouter.patch('/:locationId', requireRole('dm'), async (req, res) => {
  const input = updateLocationSchema.parse(req.body);
  const location = await locationsService.updateLocation(
    pool, req.campaignId!, (req.params.locationId as string), req.campaignRole!, input,
  );
  res.json({ location });
});

locationsRouter.delete('/:locationId', requireRole('dm'), async (req, res) => {
  await locationsService.deleteLocation(pool, req.campaignId!, (req.params.locationId as string), req.campaignRole!);
  res.status(204).send();
});

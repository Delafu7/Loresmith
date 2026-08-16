import { Router } from 'express';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { requireCampaignMember, requireRole } from '../middleware/campaign.js';
import { createLocationSchema, updateLocationSchema } from '../schemas/locations.js';
import * as locationsService from '../services/locations.js';
import { getIo, broadcastLocationsFactionsUpdated } from '../sockets/broadcast.js';

// Mounted at /campaigns/:id/locations
export const locationsRouter = Router({ mergeParams: true });
locationsRouter.use(requireAuth, requireCampaignMember());

locationsRouter.get('/', async (req, res) => {
  const locations = await locationsService.listLocations(pool, req.campaignId!, req.campaignRole!);
  res.json({ locations });
});

locationsRouter.post('/', requireRole('dm'), async (req, res) => {
  const input = createLocationSchema.parse(req.body);
  const location = await locationsService.createLocation(pool, req.campaignId!, req.campaignRole!, input);
  broadcastLocationsFactionsUpdated(getIo(req.app), req.campaignId!, 'locations');
  res.status(201).json({ location });
});

locationsRouter.patch('/:locationId', requireRole('dm'), async (req, res) => {
  const input = updateLocationSchema.parse(req.body);
  const location = await locationsService.updateLocation(
    pool, req.campaignId!, (req.params.locationId as string), req.campaignRole!, input,
  );
  broadcastLocationsFactionsUpdated(getIo(req.app), req.campaignId!, 'locations');
  res.json({ location });
});

locationsRouter.delete('/:locationId', requireRole('dm'), async (req, res) => {
  await locationsService.deleteLocation(pool, req.campaignId!, (req.params.locationId as string), req.campaignRole!);
  broadcastLocationsFactionsUpdated(getIo(req.app), req.campaignId!, 'locations');
  res.status(204).send();
});

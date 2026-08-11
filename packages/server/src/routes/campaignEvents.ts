import { Router } from 'express';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { requireCampaignMember, requireRole } from '../middleware/campaign.js';
import { createCampaignEventSchema, updateCampaignEventSchema } from '../schemas/campaignEvents.js';
import * as campaignEventsService from '../services/campaignEvents.js';

// Mounted at /campaigns/:id/events
export const campaignEventsRouter = Router({ mergeParams: true });
campaignEventsRouter.use(requireAuth, requireCampaignMember());

campaignEventsRouter.get('/', async (req, res) => {
  const events = await campaignEventsService.listCampaignEvents(pool, req.campaignId!);
  res.json({ events });
});

campaignEventsRouter.post('/', requireRole('dm'), async (req, res) => {
  const input = createCampaignEventSchema.parse(req.body);
  const event = await campaignEventsService.createCampaignEvent(pool, req.campaignId!, req.campaignRole!, input);
  res.status(201).json({ event });
});

campaignEventsRouter.patch('/:eventId', requireRole('dm'), async (req, res) => {
  const input = updateCampaignEventSchema.parse(req.body);
  const event = await campaignEventsService.updateCampaignEvent(
    pool, req.campaignId!, (req.params.eventId as string), req.campaignRole!, input,
  );
  res.json({ event });
});

campaignEventsRouter.delete('/:eventId', requireRole('dm'), async (req, res) => {
  await campaignEventsService.deleteCampaignEvent(pool, req.campaignId!, (req.params.eventId as string), req.campaignRole!);
  res.status(204).send();
});

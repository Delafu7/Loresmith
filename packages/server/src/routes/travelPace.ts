import { Router } from 'express';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { requireCampaignMember } from '../middleware/campaign.js';
import { travelPaceQuerySchema } from '../schemas/travelPace.js';
import * as travelPaceService from '../services/travelPace.js';

// Mounted at /campaigns/:id/travel-pace.
//
// docs/roadmap/dnd-2024-gap-analysis.md P3-2 (ER-07) — a stateless,
// read-only overland Travel Pace calculator. GET only, no request body,
// nothing persisted; any campaign member may call it (it exposes no
// hidden/DM-only data, just rules math parameterised by the campaign's SRD
// edition). Same "compute-and-suggest" shape as the condition-effects and
// obscurement report endpoints.
export const travelPaceRouter = Router({ mergeParams: true });
travelPaceRouter.use(requireAuth, requireCampaignMember());

travelPaceRouter.get('/', async (req, res) => {
  const query = travelPaceQuerySchema.parse(req.query);
  const plan = await travelPaceService.computeCampaignTravelPlan(pool, req.campaignId!, query);
  res.json({ plan });
});

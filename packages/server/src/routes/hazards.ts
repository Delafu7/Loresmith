import { Router } from 'express';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { requireCampaignMember, requireRole } from '../middleware/campaign.js';
import { resolveDailyHazardsSchema } from '../schemas/hazards.js';
import * as hazardsService from '../services/hazards.js';

// Mounted at /campaigns/:id/hazards.
//
// docs/roadmap/dnd-2024-gap-analysis.md P3-3 (ER-08) — the end-of-day
// Dehydration + Malnutrition resolution. DM-only (same bucket as the rest
// routes and the manual /characters/:id/exhaustion endpoint): it can add
// Exhaustion levels to any character in the campaign, so it's a DM tool, not
// a player self-service action. Burning and Suffocation are per-turn and live
// on the encounter router instead (/encounters/:id/participants/:pid/...).
export const campaignHazardsRouter = Router({ mergeParams: true });
campaignHazardsRouter.use(requireAuth, requireCampaignMember());

campaignHazardsRouter.post('/resolve-daily', requireRole('dm'), async (req, res) => {
  const input = resolveDailyHazardsSchema.parse(req.body);
  const result = await hazardsService.resolveDailyHazards(pool, req.user!.id, req.campaignId!, input);
  res.json(result);
});

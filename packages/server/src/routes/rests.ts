import { Router } from 'express';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { requireCampaignMember, requireRole } from '../middleware/campaign.js';
import { restSchema } from '../schemas/rests.js';
import * as restsService from '../services/rests.js';

// Mounted at /campaigns/:id/rests.
//
// DM-only on POST, per PLAN.md §4.1's authorization matrix line ("`POST
// /campaigns/:id/rests` ... server computes hit-dice/heal, updates
// character_resource_pools ... writes rest_events/rest_event_characters
// transactionally") sitting under the same "DM tool" bucket as HP tracking
// for NPCs and combat control — nothing in PLAN.md carves out a
// player-can-rest-their-own-character exception, and the endpoint's actual
// shape (an arbitrary characterIds[] array, which could include NPCs or
// other players' PCs) would need its own per-character ownership check to
// safely relax that anyway. Kept DM-only as specified rather than guessing
// at a narrower player-self-rest variant nothing in the plan asks for.
export const campaignRestsRouter = Router({ mergeParams: true });
campaignRestsRouter.use(requireAuth, requireCampaignMember());

campaignRestsRouter.get('/', async (req, res) => {
  const rests = await restsService.listRests(pool, req.campaignId!);
  res.json({ rests });
});

campaignRestsRouter.post('/', requireRole('dm'), async (req, res) => {
  const input = restSchema.parse(req.body);
  const result = await restsService.performRest(pool, req.user!.id, req.campaignId!, input);
  res.status(201).json(result);
});

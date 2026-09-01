import { Router } from 'express';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { requireCampaignMember, requireRole } from '../middleware/campaign.js';
import { restSchema, interruptRestSchema, completeRestSchema } from '../schemas/rests.js';
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

// docs/roadmap/dnd-2024-gap-analysis.md P2-5 (ER-04) — additive, separate
// from the instant POST / above (see services/rests.ts's own header comment
// on this flow). Same DM-only gate as every other rest-mutating route.
campaignRestsRouter.post('/start', requireRole('dm'), async (req, res) => {
  const input = restSchema.parse(req.body);
  const result = await restsService.startRest(pool, req.user!.id, req.campaignId!, input);
  res.status(201).json(result);
});

campaignRestsRouter.post('/:restId/interrupt', requireRole('dm'), async (req, res) => {
  const input = interruptRestSchema.parse(req.body);
  const restEvent = await restsService.interruptRest(pool, req.user!.id, (req.params.restId as string), input);
  res.json({ restEvent });
});

campaignRestsRouter.post('/:restId/complete', requireRole('dm'), async (req, res) => {
  const input = completeRestSchema.parse(req.body);
  const result = await restsService.completeRest(pool, req.user!.id, (req.params.restId as string), input);
  res.json(result);
});

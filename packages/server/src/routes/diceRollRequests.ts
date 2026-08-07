import { Router } from 'express';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { requireCampaignMember } from '../middleware/campaign.js';
import { createDiceRollRequestSchema } from '../schemas/diceRollRequests.js';
import * as diceRollRequestsService from '../services/diceRollRequests.js';
import { getIo, broadcastDiceRollRequested, broadcastDiceRollRequestUpdated } from '../sockets/broadcast.js';

// Mounted at /campaigns/:id/dice-roll-requests (Iteration 3 §2.3). DM-only
// to create; any campaign member may read (see listDiceRollRequests' own
// comment) or pass their own pending target.
export const diceRollRequestsRouter = Router({ mergeParams: true });
diceRollRequestsRouter.use(requireAuth, requireCampaignMember());

diceRollRequestsRouter.post('/', async (req, res) => {
  const input = createDiceRollRequestSchema.parse(req.body);
  const { request, targets } = await diceRollRequestsService.createDiceRollRequest(
    pool, req.campaignId!, req.user!.id, req.campaignRole!, input,
  );
  broadcastDiceRollRequested(getIo(req.app), req.campaignId!, request, targets.map((t) => t.user_id));
  res.status(201).json({ request, targets });
});

diceRollRequestsRouter.get('/', async (req, res) => {
  const requests = await diceRollRequestsService.listDiceRollRequests(pool, req.campaignId!, req.user!.id, req.campaignRole!);
  res.json({ requests });
});

diceRollRequestsRouter.post('/targets/:targetId/pass', async (req, res) => {
  const target = await diceRollRequestsService.passDiceRollRequestTarget(
    pool, req.campaignId!, req.user!.id, req.campaignRole!, req.params.targetId as string,
  );
  broadcastDiceRollRequestUpdated(getIo(req.app), req.campaignId!, target);
  res.json({ target });
});

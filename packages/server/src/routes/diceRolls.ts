import { Router } from 'express';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { requireCampaignMember } from '../middleware/campaign.js';
import { createDiceRollSchema, listDiceRollsQuerySchema } from '../schemas/diceRolls.js';
import * as diceRollsService from '../services/diceRolls.js';
import { getIo, broadcastDiceRolled } from '../sockets/broadcast.js';

// Mounted at /campaigns/:id/dice-rolls. No requireRole('dm') gate on the
// whole router — both DM and players may roll (per-field restrictions,
// e.g. players may only roll as their own character and can never supply
// monsterInstanceId or hide a roll, are enforced inside
// services/diceRolls.ts's rollDice, not here).
export const diceRollsRouter = Router({ mergeParams: true });
diceRollsRouter.use(requireAuth, requireCampaignMember());

diceRollsRouter.post('/', async (req, res) => {
  const input = createDiceRollSchema.parse(req.body);
  const roll = await diceRollsService.rollDice(pool, req.campaignId!, req.user!.id, req.campaignRole!, input);
  // Broadcast only after the insert has committed (pool.query() in rollDice
  // already returned), same "broadcast only after commit" discipline used
  // everywhere else in this codebase.
  await broadcastDiceRolled(getIo(req.app), req.campaignId!, roll);
  res.status(201).json({ roll });
});

diceRollsRouter.get('/', async (req, res) => {
  const query = listDiceRollsQuerySchema.parse(req.query);
  const { rolls, nextCursor } = await diceRollsService.listDiceRolls(pool, req.campaignId!, req.campaignRole!, query);
  res.json({ rolls, nextCursor });
});

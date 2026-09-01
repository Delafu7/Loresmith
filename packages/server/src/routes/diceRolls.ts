import { Router } from 'express';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { requireCampaignMember } from '../middleware/campaign.js';
import { createDiceRollSchema, listDiceRollsQuerySchema } from '../schemas/diceRolls.js';
import * as diceRollsService from '../services/diceRolls.js';
import {
  getIo, broadcastDiceRolled, broadcastDiceRollVoided, broadcastDiceRollRequestUpdated, broadcastEffectExpired,
} from '../sockets/broadcast.js';

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
  // docs/roadmap/dnd-2024-gap-analysis.md P1-13 — an attack roll may have
  // just broken an active Invisible effect (services/diceRolls.ts's rollDice,
  // same transaction as the roll insert); only set when that effect belonged
  // to an encounter (Hide/Invisibility applied outside combat has no
  // participant sync target to notify here).
  const cleared = roll.clearedInvisibleEffect;
  if (cleared && cleared.encounter_id !== null) {
    await broadcastEffectExpired(
      getIo(req.app),
      { encounter_id: cleared.encounter_id, campaign_id: req.campaignId!, sync_seq: cleared.encounter_sync_seq! },
      cleared,
      cleared.effect_definition_name,
    );
  }
  // If this roll fulfilled a GM roll request, tell every connected client
  // that target's status changed — the request/target metadata is never
  // sensitive (see broadcastDiceRollRequestUpdated's own comment), so this
  // fires regardless of the roll's own visibility.
  if (input.fulfillsRequestTargetId !== undefined) {
    const targetRow = await pool.query<{ id: string; request_id: string }>(
      `SELECT id, request_id FROM dice_roll_request_targets WHERE id = $1`,
      [input.fulfillsRequestTargetId],
    );
    if (targetRow.rows[0]) {
      broadcastDiceRollRequestUpdated(getIo(req.app), req.campaignId!, {
        id: targetRow.rows[0].id,
        request_id: targetRow.rows[0].request_id,
        status: 'rolled',
        dice_roll_id: roll.id,
      });
    }
  }
  res.status(201).json({ roll });
});

diceRollsRouter.get('/', async (req, res) => {
  const query = listDiceRollsQuerySchema.parse(req.query);
  const { rolls, nextCursor } = await diceRollsService.listDiceRolls(pool, req.campaignId!, req.user!.id, req.campaignRole!, query);
  res.json({ rolls, nextCursor });
});

// Void, not delete (Iteration 3 §2.4) — DM, or the roller themself.
diceRollsRouter.post('/:rollId/void', async (req, res) => {
  const roll = await diceRollsService.voidDiceRoll(pool, req.campaignId!, req.user!.id, req.campaignRole!, req.params.rollId as string);
  await broadcastDiceRollVoided(getIo(req.app), req.campaignId!, roll);
  res.json({ roll });
});

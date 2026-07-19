import { Router } from 'express';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { AppError, notFound } from '../middleware/errors.js';
import { requireDm, requireMembership } from '../services/authz.js';
import { applyEncounterEffectSchema } from '../schemas/effects.js';
import * as effectsService from '../services/effects.js';
import { getIo, broadcastEffectApplied, broadcastEffectExpired } from '../sockets/broadcast.js';

// Mounted at /encounters — sibling to the start/end/participants/roll-
// initiative/advance-turn action routes in routes/encounters.ts. Kept in its
// own file since this task's scope is effects specifically, but follows the
// exact same requireEncounterDm-style derivation: no campaignId in the URL,
// so membership (for GET, any role) / DM role (for POST) is derived from the
// encounter row itself.
async function loadEncounterCampaignId(encounterId: number): Promise<number> {
  if (!Number.isInteger(encounterId)) throw new AppError('VALIDATION_ERROR', 'Invalid encounter id');
  const result = await pool.query<{ campaign_id: number }>(`SELECT campaign_id FROM encounters WHERE id = $1`, [encounterId]);
  const row = result.rows[0];
  if (!row) throw notFound('Encounter');
  return row.campaign_id;
}

export const encounterEffectsRouter = Router();
encounterEffectsRouter.use(requireAuth);

encounterEffectsRouter.get('/:id/effects', async (req, res) => {
  const encounterId = Number(req.params.id);
  const campaignId = await loadEncounterCampaignId(encounterId);
  const role = await requireMembership(pool, campaignId, req.user!.id);
  const effects = await effectsService.listEncounterEffects(pool, encounterId, role);
  res.json({ effects });
});

encounterEffectsRouter.post('/:id/effects', async (req, res) => {
  const encounterId = Number(req.params.id);
  const campaignId = await loadEncounterCampaignId(encounterId);
  const role = await requireMembership(pool, campaignId, req.user!.id);
  requireDm(role);
  const input = applyEncounterEffectSchema.parse(req.body);
  const { effect, effectDefinitionName, encounterSyncs, replacedEffect } = await effectsService.applyEncounterEffect(pool, encounterId, campaignId, input);
  const io = getIo(req.app);
  for (const sync of encounterSyncs) {
    // A new concentration effect auto-ends the target's prior one (SRD rule)
    // — broadcast its expiry first so clients don't show two concentration
    // effects active at once, even momentarily.
    if (replacedEffect) {
      await broadcastEffectExpired(io, sync, replacedEffect.effect, replacedEffect.effectDefinitionName);
    }
    await broadcastEffectApplied(io, sync, effect, effectDefinitionName);
  }
  res.status(201).json({ effect });
});

// Mounted at /effects — flat single-resource action (campaign derived from
// the effect's target row, same pattern as routes/monsters.ts's flat
// /monster-instances/:id/hp).
export const effectsRouter = Router();
effectsRouter.use(requireAuth);

effectsRouter.delete('/:id', async (req, res) => {
  const { effect, effectDefinitionName, encounterSyncs } = await effectsService.removeEffect(pool, req.user!.id, Number(req.params.id));
  const io = getIo(req.app);
  for (const sync of encounterSyncs) {
    await broadcastEffectExpired(io, sync, effect, effectDefinitionName);
  }
  res.status(204).send();
});

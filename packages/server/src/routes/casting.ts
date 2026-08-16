// Mounted at /encounters — sibling to routes/effects.ts's
// encounterEffectsRouter, same "no campaignId in the URL, derive it from
// the encounter row" shape. Kept in its own file since casting orchestrates
// two OTHER services (resourcePools + effects) rather than owning a
// resource of its own — see services/casting.ts's header comment for the
// full design rationale (why this bypasses routes/effects.ts's DM-only
// gate, and why it's not one shared DB transaction).
import { Router } from 'express';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { AppError, notFound } from '../middleware/errors.js';
import { isUuid } from '../domain/ids.js';
import { castFromEncounterSchema } from '../schemas/casting.js';
import { castFromEncounter } from '../services/casting.js';
import {
  getIo,
  broadcastEffectApplied,
  broadcastEffectExpired,
  broadcastResourcePoolChanged,
  broadcastPendingActionCreated,
} from '../sockets/broadcast.js';

async function loadEncounterCampaignId(encounterId: string): Promise<string> {
  if (!isUuid(encounterId)) throw new AppError('VALIDATION_ERROR', 'Invalid encounter id');
  const result = await pool.query<{ campaign_id: string }>(`SELECT campaign_id FROM encounters WHERE id = $1`, [encounterId]);
  const row = result.rows[0];
  if (!row) throw notFound('Encounter');
  return row.campaign_id;
}

export const castingRouter = Router();
castingRouter.use(requireAuth);

castingRouter.post('/:id/cast', async (req, res) => {
  const encounterId = req.params.id as string;
  // Authorization (owner-or-DM of the casting character) lives inside
  // castFromEncounter itself, not here — this route only needs the
  // encounter to exist, same shape as loadEncounterCampaignId's callers in
  // routes/effects.ts.
  await loadEncounterCampaignId(encounterId);
  const input = castFromEncounterSchema.parse(req.body);
  const result = await castFromEncounter(pool, req.user!.id, encounterId, input);

  const io = getIo(req.app);

  // Phase 4 "DM approval before a player-submitted action resolves" — see
  // routes/monsters.ts's apply-damage route for the identical branch.
  if ('pending' in result) {
    await broadcastPendingActionCreated(io, result.request.campaign_id, result.request);
    res.status(202).json({ pending: true, request: result.request });
    return;
  }

  const { resourcePool, campaignId, appliedEffects } = result;
  broadcastResourcePoolChanged(io, campaignId, input.characterId, resourcePool);
  for (const applied of appliedEffects) {
    for (const sync of applied.encounterSyncs) {
      if (applied.replacedEffect) {
        await broadcastEffectExpired(io, sync, applied.replacedEffect.effect, applied.replacedEffect.effectDefinitionName);
      }
      await broadcastEffectApplied(io, sync, applied.effect, applied.effectDefinitionName);
    }
  }

  res.status(201).json({ resourcePool, appliedEffects: appliedEffects.map((a) => a.effect) });
});

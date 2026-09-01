// Phase 4 "DM approval before a player-submitted action resolves" — the
// dispatch layer for the pending-request queue. Mounted at /encounters,
// sibling to routes/casting.ts (no campaignId in the URL, same "derive it
// from the encounter row" shape isn't even needed here since
// services/pendingActions.ts resolves campaign membership from the request
// row itself).
//
// This file is the one place that needs to import ALL SIX resolvers
// (applyDamage/applyMonsterInstanceDamage/castFromEncounter/performShove/
// performGrapple/performHide) to dispatch approval by `kind` — see
// services/pendingActions.ts's header comment for why that dispatch doesn't
// live there instead (avoids a five-way service import cycle). Approving
// replays the exact same resolver the DM's own unconditional path already
// uses, with the DM's own actorId — which is always role='dm' inside that
// resolver, so it always takes the "resolve immediately" branch, never the
// "queue another pending request" branch, no matter who originally
// submitted it.
import { Router, type Request } from 'express';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { AppError, notFound } from '../middleware/errors.js';
import { isUuid } from '../domain/ids.js';
import * as pendingActionsService from '../services/pendingActions.js';
import * as charactersService from '../services/characters.js';
import * as monstersService from '../services/monsters.js';
import { castFromEncounter } from '../services/casting.js';
import { performShove } from '../services/shove.js';
import { performGrapple } from '../services/grapple.js';
import { performHide } from '../services/hide.js';
import * as combatActionsService from '../services/combatActions.js';
import type { ApplyDamageInput } from '../schemas/damage.js';
import type { CastFromEncounterInput } from '../schemas/casting.js';
import type { PerformShoveInput } from '../schemas/shove.js';
import type { PerformGrappleInput } from '../schemas/grapple.js';
import type { PerformHideInput } from '../schemas/hide.js';
import {
  getIo,
  broadcastHpChanged,
  broadcastConcentrationCheckPrompted,
  broadcastResourcePoolChanged,
  broadcastEffectApplied,
  broadcastEffectExpired,
  broadcastActionEconomyChanged,
  broadcastDiceRolled,
  broadcastActionRecorded,
  broadcastPendingActionResolved,
} from '../sockets/broadcast.js';

export const pendingActionsRouter = Router();
pendingActionsRouter.use(requireAuth);

pendingActionsRouter.get('/:id/pending-actions', async (req, res) => {
  const encounterId = req.params.id as string;
  if (!isUuid(encounterId)) throw new AppError('VALIDATION_ERROR', 'Invalid encounter id');
  const requests = await pendingActionsService.listPendingActions(pool, req.user!.id, encounterId);
  res.json({ requests });
});

// Resolves an already-approved request by replaying the resolver its `kind`
// maps to, then fires the exact broadcasts that resolver's OWN route would
// have fired had it resolved synchronously (see routes/characters.ts,
// routes/monsters.ts, routes/casting.ts, routes/encounters.ts's shove/
// grapple handlers — each branch here mirrors one of those one-for-one).
async function resolveApprovedRequest(req: Request, pending: pendingActionsService.PendingActionRequestRow): Promise<void> {
  const io = getIo(req.app);
  const actorId = req.user!.id;

  switch (pending.kind) {
    case 'attack_character': {
      const { characterId, damage } = pending.payload as { characterId: string; damage: ApplyDamageInput };
      const result = await charactersService.applyDamage(pool, actorId, characterId, damage);
      if ('pending' in result) throw new AppError('CONFLICT', 'Unexpected: DM approval produced another pending request');
      await Promise.all(
        result.encounterSyncs.map((sync) =>
          broadcastHpChanged(io, {
            encounterId: sync.encounter_id,
            campaignId: sync.campaign_id,
            seq: sync.sync_seq,
            participantId: sync.participant_id,
            characterId,
            monsterInstanceId: null,
            hpCurrent: result.character.hp_current as number,
            hpMax: result.character.hp_max as number,
            hpTemp: result.character.hp_temp as number,
            delta: -result.appliedDamage,
          }),
        ),
      );
      if (result.concentrationCheck) {
        const controllerUserId = (result.character.controller_user_id ?? result.character.owner_user_id ?? null) as string | null;
        await Promise.all(
          result.encounterSyncs.map((sync) =>
            broadcastConcentrationCheckPrompted(io, {
              encounterId: sync.encounter_id,
              campaignId: sync.campaign_id,
              characterId,
              monsterInstanceId: null,
              effectId: result.concentrationCheck!.effectId,
              effectDefinitionId: result.concentrationCheck!.effectDefinitionId,
              effectName: result.concentrationCheck!.effectName,
              dc: result.concentrationCheck!.dc,
              damage: result.appliedDamage,
              controllerUserId,
            }),
          ),
        );
      }
      await pendingActionsService.markPendingApproved(pool, actorId, pending.id, {
        character: result.character,
        diceRoll: result.diceRoll,
        rawTotal: result.rawTotal,
        appliedDamage: result.appliedDamage,
        breakdown: result.breakdown,
        concentrationCheck: result.concentrationCheck,
      });
      return;
    }
    case 'attack_monster': {
      const { instanceId, damage } = pending.payload as { instanceId: string; damage: ApplyDamageInput };
      const result = await monstersService.applyMonsterInstanceDamage(pool, actorId, instanceId, damage);
      if ('pending' in result) throw new AppError('CONFLICT', 'Unexpected: DM approval produced another pending request');
      await Promise.all(
        result.encounterSyncs.map((sync) =>
          broadcastHpChanged(io, {
            encounterId: sync.encounter_id,
            campaignId: sync.campaign_id,
            seq: sync.sync_seq,
            participantId: sync.participant_id,
            characterId: null,
            monsterInstanceId: instanceId,
            hpCurrent: result.monsterInstance.hp_current as number,
            hpMax: (result.monsterInstance.hp_max_override as number | null) ?? (result.monsterInstance.hit_point_average as number),
            hpTemp: result.monsterInstance.hp_temp as number,
            delta: -result.appliedDamage,
          }),
        ),
      );
      if (result.concentrationCheck) {
        await Promise.all(
          result.encounterSyncs.map((sync) =>
            broadcastConcentrationCheckPrompted(io, {
              encounterId: sync.encounter_id,
              campaignId: sync.campaign_id,
              characterId: null,
              monsterInstanceId: instanceId,
              effectId: result.concentrationCheck!.effectId,
              effectDefinitionId: result.concentrationCheck!.effectDefinitionId,
              effectName: result.concentrationCheck!.effectName,
              dc: result.concentrationCheck!.dc,
              damage: result.appliedDamage,
              controllerUserId: null,
            }),
          ),
        );
      }
      await pendingActionsService.markPendingApproved(pool, actorId, pending.id, {
        monsterInstance: result.monsterInstance,
        diceRoll: result.diceRoll,
        rawTotal: result.rawTotal,
        appliedDamage: result.appliedDamage,
        breakdown: result.breakdown,
        concentrationCheck: result.concentrationCheck,
      });
      return;
    }
    case 'cast': {
      const input = pending.payload as CastFromEncounterInput;
      const result = await castFromEncounter(pool, actorId, pending.encounter_id, input);
      if ('pending' in result) throw new AppError('CONFLICT', 'Unexpected: DM approval produced another pending request');
      broadcastResourcePoolChanged(io, result.campaignId, input.characterId, result.resourcePool);
      for (const applied of result.appliedEffects) {
        for (const sync of applied.encounterSyncs) {
          if (applied.replacedEffect) {
            await broadcastEffectExpired(io, sync, applied.replacedEffect.effect, applied.replacedEffect.effectDefinitionName);
          }
          await broadcastEffectApplied(io, sync, applied.effect, applied.effectDefinitionName);
        }
      }
      await pendingActionsService.markPendingApproved(pool, actorId, pending.id, {
        resourcePool: result.resourcePool,
        appliedEffects: result.appliedEffects.map((a) => a.effect),
      });
      return;
    }
    case 'shove': {
      const input = pending.payload as PerformShoveInput;
      const result = await performShove(pool, pending.encounter_id, pending.actor_participant_id, actorId, input);
      if ('pending' in result) throw new AppError('CONFLICT', 'Unexpected: DM approval produced another pending request');
      await broadcastActionEconomyChanged(io, result.encounter, result.participant);
      await broadcastDiceRolled(io, result.encounter.campaign_id, result.attackerRoll);
      if (result.defenderRoll) await broadcastDiceRolled(io, result.encounter.campaign_id, result.defenderRoll);
      const shoveAction = await combatActionsService.recordAction(pool, actorId, pending.encounter_id, {
        actorParticipantId: pending.actor_participant_id,
        targetParticipantIds: [input.targetParticipantId],
        actionType: 'ability',
        meansLabel: 'Shove',
        diceRollId: result.attackerRoll.id,
        resultKind: result.success ? 'effect' : 'miss',
        effectDescription: result.success ? (result.outcome === 'push_5ft' ? 'Pushed 5 feet away' : 'Knocked prone') : undefined,
      });
      await broadcastActionRecorded(io, pool, shoveAction, result.encounter.campaign_id);
      await pendingActionsService.markPendingApproved(pool, actorId, pending.id, {
        participant: result.participant,
        attackerRoll: result.attackerRoll,
        defenderRoll: result.defenderRoll,
        defenderTotal: result.defenderTotal,
        defenderOverridden: result.defenderOverridden,
        success: result.success,
        outcome: result.outcome,
        message: result.message,
      });
      return;
    }
    case 'grapple': {
      const input = pending.payload as PerformGrappleInput;
      const result = await performGrapple(pool, pending.encounter_id, pending.actor_participant_id, actorId, input);
      if ('pending' in result) throw new AppError('CONFLICT', 'Unexpected: DM approval produced another pending request');
      await broadcastActionEconomyChanged(io, result.encounter, result.participant);
      await broadcastDiceRolled(io, result.encounter.campaign_id, result.attackerRoll);
      if (result.defenderRoll) await broadcastDiceRolled(io, result.encounter.campaign_id, result.defenderRoll);
      if (result.appliedEffect) {
        await Promise.all(
          result.appliedEffect.encounterSyncs.map((sync) =>
            broadcastEffectApplied(io, sync, result.appliedEffect!.effect, result.appliedEffect!.effectDefinitionName),
          ),
        );
      }
      const grappleAction = await combatActionsService.recordAction(pool, actorId, pending.encounter_id, {
        actorParticipantId: pending.actor_participant_id,
        targetParticipantIds: [input.targetParticipantId],
        actionType: 'ability',
        meansLabel: 'Grapple',
        diceRollId: result.attackerRoll.id,
        resultKind: result.success ? 'effect' : 'miss',
        effectDescription: result.success ? 'Grappled' : undefined,
      });
      await broadcastActionRecorded(io, pool, grappleAction, result.encounter.campaign_id);
      await pendingActionsService.markPendingApproved(pool, actorId, pending.id, {
        participant: result.participant,
        attackerRoll: result.attackerRoll,
        defenderRoll: result.defenderRoll,
        defenderTotal: result.defenderTotal,
        defenderOverridden: result.defenderOverridden,
        success: result.success,
        appliedEffect: result.appliedEffect?.effect ?? null,
        message: result.message,
      });
      return;
    }
    case 'hide': {
      const input = pending.payload as PerformHideInput;
      const result = await performHide(pool, pending.encounter_id, pending.actor_participant_id, actorId, input);
      if ('pending' in result) throw new AppError('CONFLICT', 'Unexpected: DM approval produced another pending request');
      await broadcastActionEconomyChanged(io, result.encounter, result.participant);
      await broadcastDiceRolled(io, result.encounter.campaign_id, result.checkRoll);
      if (result.appliedEffect) {
        await Promise.all(
          result.appliedEffect.encounterSyncs.map((sync) =>
            broadcastEffectApplied(io, sync, result.appliedEffect!.effect, result.appliedEffect!.effectDefinitionName),
          ),
        );
      }
      const hideAction = await combatActionsService.recordAction(pool, actorId, pending.encounter_id, {
        actorParticipantId: pending.actor_participant_id,
        targetParticipantIds: [pending.actor_participant_id],
        actionType: 'ability',
        meansLabel: 'Hide',
        diceRollId: result.checkRoll.id,
        resultKind: result.success ? 'effect' : 'miss',
        effectDescription: result.success ? 'Hidden (Invisible)' : undefined,
      });
      await broadcastActionRecorded(io, pool, hideAction, result.encounter.campaign_id);
      await pendingActionsService.markPendingApproved(pool, actorId, pending.id, {
        participant: result.participant,
        checkRoll: result.checkRoll,
        success: result.success,
        appliedEffect: result.appliedEffect?.effect ?? null,
        message: result.message,
      });
      return;
    }
  }
}

pendingActionsRouter.post('/:id/pending-actions/:requestId/approve', async (req, res) => {
  const requestId = req.params.requestId as string;
  if (!isUuid(requestId)) throw new AppError('VALIDATION_ERROR', 'Invalid request id');
  const pending = await pendingActionsService.fetchPendingForResolution(pool, req.user!.id, requestId);

  try {
    await resolveApprovedRequest(req, pending);
  } catch (err) {
    const message = err instanceof AppError ? err.message : 'Resolution failed';
    await pendingActionsService.markPendingFailed(pool, requestId, message);
    throw err;
  }

  const finalRow = await pendingActionsService.fetchPendingById(pool, requestId);
  await broadcastPendingActionResolved(getIo(req.app), finalRow.campaign_id, finalRow);
  res.json({ request: finalRow });
});

pendingActionsRouter.post('/:id/pending-actions/:requestId/reject', async (req, res) => {
  const requestId = req.params.requestId as string;
  if (!isUuid(requestId)) throw new AppError('VALIDATION_ERROR', 'Invalid request id');
  await pendingActionsService.fetchPendingForResolution(pool, req.user!.id, requestId);
  const rejected = await pendingActionsService.markPendingRejected(pool, req.user!.id, requestId);
  await broadcastPendingActionResolved(getIo(req.app), rejected.campaign_id, rejected);
  res.json({ request: rejected });
});

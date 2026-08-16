// Cast-from-encounter (brief: "spend the slot, apply the effect/condition
// to targets"). Before this, spending a spell slot (SpellcastingPanel, the
// character sheet) and applying an effect within an encounter
// (EffectApplyDialog, DM-only) were two disconnected manual steps with no
// link between "which spell" and "which effect" or "which slot to
// decrement." This orchestrates both in one action, reusing the two
// already-correct primitives as-is: resourcePools.ts's spendResource and
// effects.ts's applyEncounterEffect.
//
// Deliberately NOT one shared DB transaction across both: spendResource's
// atomic single-statement UPDATE and applyEncounterEffect's own internal
// insertActiveEffect transaction are each independently correct, but
// neither accepts an externally-managed client today, and widening that
// (so a slot-spend and N effect-applies could share one BEGIN/COMMIT)
// would touch shared services with a much wider blast radius than this
// increment's scope. Practical effect of that choice: if the slot-spend
// succeeds but a later target's effect application fails (e.g. an invalid
// participant id), the slot stays spent and earlier targets keep their
// effect — a DM-recoverable UX rough edge (undo the spend or apply the
// effect manually), not a data-corruption risk, since nothing here can
// leave a HALF-applied single effect or a double-spent slot.
//
// Authorization: reuses authorizeCharacterMutation (owner-or-DM) as the
// single gate for the WHOLE action, including the effect-application half
// — a deliberate departure from routes/effects.ts's POST /encounters/:id/
// effects (DM-only), because casting one's own known spell is fundamentally
// a player action, same as spendResource already allowing owner-or-DM.

import type { Pool } from 'pg';
import { notFound } from '../middleware/errors.js';
import { authorizeCharacterMutation, fetchCharacterOrThrow } from './characters.js';
import { spendResource } from './resourcePools.js';
import { applyEncounterEffect, type EffectMutationResult } from './effects.js';
import { requireCurrentTurn } from './encounters.js';
import { createPendingAction, type PendingActionCreated } from './pendingActions.js';
import type { CastFromEncounterInput } from '../schemas/casting.js';

export interface CastFromEncounterResult {
  resourcePool: Record<string, unknown>;
  campaignId: string;
  appliedEffects: EffectMutationResult[];
}

export async function castFromEncounter(
  pool: Pool,
  actorId: string,
  encounterId: string,
  input: CastFromEncounterInput,
): Promise<CastFromEncounterResult | PendingActionCreated> {
  const character = await fetchCharacterOrThrow(pool, input.characterId);
  const role = await authorizeCharacterMutation(pool, actorId, character);

  // Phase 3 "players cast from their own UI" — control was already verified
  // above (owner-or-DM of the casting character); this adds the turn-order
  // enforcement Phase 1/2 already applies to attacks, for combat parity. A
  // no-op if the character has no combat_participants row for this encounter
  // (e.g. casting isn't otherwise scoped to an active combat here) — same
  // "can't reason about it, don't block" precedent as
  // services/encounters.ts's computeValidatedMoveCost. Phase 4 "DM approval"
  // gating only applies when there IS a participant row to attribute the
  // request to — the same no-op edge case skips both.
  if (role !== 'dm') {
    const participantRes = await pool.query<{
      id: string;
      turn_order: number;
      status: 'preparing' | 'active' | 'paused' | 'completed';
      current_turn_index: number;
    }>(
      `SELECT cp.id, cp.turn_order, e.status, e.current_turn_index
       FROM combat_participants cp
       JOIN encounters e ON e.id = cp.encounter_id
       WHERE cp.character_id = $1 AND cp.encounter_id = $2`,
      [input.characterId, encounterId],
    );
    const participant = participantRes.rows[0];
    if (participant) {
      requireCurrentTurn(
        { status: participant.status, current_turn_index: participant.current_turn_index },
        { turn_order: participant.turn_order },
      );

      // Phase 4 "DM approval before a player-submitted action resolves" —
      // same "stop here and queue it" branch as services/monsters.ts's
      // applyMonsterInstanceDamage; see that function's comment for the full
      // rationale.
      const request = await createPendingAction(pool, {
        encounterId,
        campaignId: character.campaign_id,
        requestedByUserId: actorId,
        actorParticipantId: participant.id,
        targetParticipantIds: input.targetParticipantIds,
        kind: 'cast',
        label: 'Cast',
        payload: input,
      });
      return { pending: true, request };
    }
  }

  const { resource: resourcePool, campaignId } = await spendResource(pool, actorId, input.characterId, input.resourceKey, { amount: 1 });

  const appliedEffects: EffectMutationResult[] = [];
  if (input.effectDefinitionId) {
    for (const participantId of input.targetParticipantIds) {
      const participantRes = await pool.query<{ character_id: string | null; monster_instance_id: string | null }>(
        `SELECT character_id, monster_instance_id FROM combat_participants WHERE id = $1 AND encounter_id = $2`,
        [participantId, encounterId],
      );
      const participant = participantRes.rows[0];
      if (!participant) throw notFound('Participant');

      const result = await applyEncounterEffect(pool, encounterId, character.campaign_id, {
        effectDefinitionId: input.effectDefinitionId,
        characterId: participant.character_id ?? undefined,
        monsterInstanceId: participant.monster_instance_id ?? undefined,
        sourceCharacterId: input.characterId,
        sourceSpellId: input.spellId ?? null,
        sourceType: 'spell',
        durationValue: input.durationValue ?? undefined,
        saveDc: input.saveDc ?? undefined,
        saveAbilityId: input.saveAbilityId ?? undefined,
        concentration: input.concentration,
        notes: input.notes ?? undefined,
      });
      appliedEffects.push(result);
    }
  }

  return { resourcePool, campaignId, appliedEffects };
}

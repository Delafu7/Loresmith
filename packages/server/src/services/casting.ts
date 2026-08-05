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
import type { CastFromEncounterInput } from '../schemas/casting.js';

export interface CastFromEncounterResult {
  resourcePool: Record<string, unknown>;
  appliedEffects: EffectMutationResult[];
}

export async function castFromEncounter(
  pool: Pool,
  actorId: string,
  encounterId: string,
  input: CastFromEncounterInput,
): Promise<CastFromEncounterResult> {
  const character = await fetchCharacterOrThrow(pool, input.characterId);
  await authorizeCharacterMutation(pool, actorId, character);

  const resourcePool = await spendResource(pool, actorId, input.characterId, input.resourceKey, { amount: 1 });

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

  return { resourcePool, appliedEffects };
}

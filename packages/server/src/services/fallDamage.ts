// Falling (docs/roadmap/dnd-2024-gap-analysis.md P3-1, ER-06). Rule source:
// rulesGlossary.md line 858-862, "Falling [Hazard]": "A creature that falls
// takes 1d6 Bludgeoning damage at the end of the fall for every 10 feet it
// fell, to a maximum of 20d6. When the creature lands, it has the Prone
// condition unless it avoids taking any damage from the fall." Confirmed
// identical in 2014 (.opencode/skills/dnd5e-srd/references/2014/
// adventuring.md's own "Falling" section) — no edition branch needed, unlike
// most of this roadmap's P0/P1 items.
//
// This item was explicitly blocked (gap analysis's own text) on "elevation/
// pit-trigger support not existing in the map model" — that foundation is
// now combat_participants.elevation_ft (migration
// 1784269842666_add-participant-elevation.ts) and map_cell_overrides'
// 'pit'/pit_depth_ft (1784269843666_add-map-cell-pit.ts; the resulting
// pitTriggered report lives on services/encounters.ts's
// setParticipantPosition — see that function's own comment). Both are DM-
// tunable board attributes, matching vision_radius_ft/cover's existing
// "small DM knob" shape, not a full physics simulation.
//
// Deliberately reuses the EXISTING applyDamage/applyMonsterInstanceDamage
// pipeline rather than a parallel HP-mutation path: fall damage is ordinary
// bludgeoning damage subject to the exact same resistance/vulnerability/
// immunity, temp-HP absorption, and death-save/massive-damage/unconscious
// transitions any other hit is (docs/rules/attacks-and-damage.md) —
// computeFallDamageDiceCount (services/damage.ts) is the only new derived
// input those functions need, matching applyDamageSchema's own
// diceCount: 0 precedent (P1-6's Graze reuses the same endpoint for a
// dice-less damage source rather than a second damage function).

import type { Pool } from 'pg';
import { AppError, notFound } from '../middleware/errors.js';
import { applyDamage, type ApplyDamageResult } from './characters.js';
import { applyMonsterInstanceDamage, type ApplyMonsterInstanceDamageResult } from './monsters.js';
import { insertActiveEffect, type EffectMutationResult } from './effects.js';
import type { PendingActionCreated } from './pendingActions.js';
import { computeFallDamageDiceCount } from './damage.js';
import type { PerformFallInput } from '../schemas/fallDamage.js';

async function fetchProneEffectDefinitionId(pool: Pool): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `SELECT id FROM effect_definitions WHERE name = 'Prone' AND condition_id IS NOT NULL LIMIT 1`,
  );
  const row = result.rows[0];
  if (!row) throw new AppError('CONFLICT', 'No "Prone" effect definition found in the catalog — seed effect_definitions first');
  return row.id;
}

export interface FallDamageResult {
  encounterId: string;
  campaignId: string;
  participantId: string;
  characterId: string | null;
  monsterInstanceId: string | null;
  distanceFt: number;
  diceCount: number;
  appliedDamage: number;
  /** rulesGlossary.md line 860 — Prone unless the fall dealt no damage at all. */
  landedProne: boolean;
  elevationFt: number;
  /** null when diceCount is 0 (a fall under 10 ft) — see this function's own
   * comment on why that case never calls applyDamage/applyMonsterInstanceDamage. */
  damage: ApplyDamageResult | ApplyMonsterInstanceDamageResult | null;
  proneEffect: EffectMutationResult | null;
}

export async function performFallDamage(
  pool: Pool,
  encounterId: string,
  participantId: string,
  actorId: string,
  input: PerformFallInput,
): Promise<FallDamageResult | PendingActionCreated> {
  const participantRes = await pool.query<{
    id: string; character_id: string | null; monster_instance_id: string | null; elevation_ft: number; campaign_id: string;
  }>(
    `SELECT cp.id, cp.character_id, cp.monster_instance_id, cp.elevation_ft, e.campaign_id
     FROM combat_participants cp JOIN encounters e ON e.id = cp.encounter_id
     WHERE cp.id = $1 AND cp.encounter_id = $2`,
    [participantId, encounterId],
  );
  const participant = participantRes.rows[0];
  if (!participant) throw notFound('Participant');

  const diceCount = computeFallDamageDiceCount(input.distanceFt);
  const elevationFt = Math.max(0, participant.elevation_ft - input.distanceFt);

  // A fall under 10 ft rolls 0 dice — guaranteed 0 damage (rulesGlossary.md's
  // own floor-division formula), so it never lands Prone either. Skipped
  // entirely rather than routed through applyDamage/applyMonsterInstanceDamage
  // with diceCount: 0: dice_rolls has a live DB CHECK constraint
  // (dice_count >= 1) that a 0-count roll violates whenever encounterId is
  // also supplied — a real, PRE-EXISTING gap in applyDamageSchema's own
  // diceCount: 0 precedent (documented there for P1-6's Graze, which never
  // actually exercises it — Graze only tells the caller to "resolve via the
  // normal damage-application call," it doesn't make that call itself).
  // Flagged here, not fixed: fixing the shared apply-damage endpoint is out
  // of scope for this item. Falling sidesteps it by simply never making that
  // call for a 0-dice fall, which is also the mechanically correct thing to
  // do (there is nothing to roll).
  if (diceCount === 0) {
    await pool.query(`UPDATE combat_participants SET elevation_ft = $1 WHERE id = $2`, [elevationFt, participantId]);
    return {
      encounterId, campaignId: participant.campaign_id, participantId,
      characterId: participant.character_id, monsterInstanceId: participant.monster_instance_id,
      distanceFt: input.distanceFt, diceCount, appliedDamage: 0, landedProne: false, elevationFt, damage: null, proneEffect: null,
    };
  }

  // Structurally matches schemas/damage.ts's ApplyDamageInput (isCritical
  // included even though both functions re-derive it themselves — see
  // deriveIsCriticalFromAttackRoll's own comment — since falling never has
  // a backing attack roll, isCritical/attackRollId are never in play here;
  // no attackerParticipantId is sent, so neither function's DM-approval
  // pending-queue branch is ever reached — a fall isn't an attack someone
  // else is making, it's the same "acting on your own target" gate
  // applyHpDelta/spendHitDice already use).
  const damageInput = {
    diceSides: 6 as const,
    diceCount,
    modifier: 0,
    damageType: 'bludgeoning',
    isCritical: false,
    encounterId,
    rollContext: 'Falling',
    saveDc: input.saveDc,
    savingThrowRollId: input.savingThrowRollId,
    halfOnSave: input.halfOnSave,
  };

  const damage = participant.character_id
    ? await applyDamage(pool, actorId, participant.character_id, damageInput)
    : await applyMonsterInstanceDamage(pool, actorId, participant.monster_instance_id!, damageInput);

  // Defensive only — unreachable in practice, see the comment above: neither
  // function's pending branch triggers without attackerParticipantId.
  if ('pending' in damage) return damage;

  let proneEffect: EffectMutationResult | null = null;
  const landedProne = damage.appliedDamage > 0;
  if (landedProne) {
    const proneEffectDefinitionId = await fetchProneEffectDefinitionId(pool);
    proneEffect = await insertActiveEffect(pool, {
      effectDefinitionId: proneEffectDefinitionId,
      characterId: participant.character_id,
      monsterInstanceId: participant.monster_instance_id,
      encounterId,
      sourceType: 'manual',
      notes: `Fell ${input.distanceFt} ft.`,
    });
  }

  await pool.query(`UPDATE combat_participants SET elevation_ft = $1 WHERE id = $2`, [elevationFt, participantId]);

  return {
    encounterId,
    campaignId: participant.campaign_id,
    participantId,
    characterId: participant.character_id,
    monsterInstanceId: participant.monster_instance_id,
    distanceFt: input.distanceFt,
    diceCount,
    appliedDamage: damage.appliedDamage,
    landedProne,
    elevationFt,
    damage,
    proneEffect,
  };
}

// Grapple Check Against a Specific NPC — mirrors services/shove.ts almost
// exactly (same PC-attacker/NPC-defender scope, same contested-roll shape,
// same requireEncounterDm gating at the route layer), per docs/rules/actions.md's
// Grapple section (2014-confirmed mechanic: Str(Athletics) vs. the target's
// own choice of Str(Athletics) or Dex(Acrobatics); target must be no more
// than one size category larger — reuses shove.ts's canShoveSize, since 5e's
// size-cap rule is identical for both actions). 2024's exact restructuring
// of Grapple (folded into an Unarmed Strike's on-hit options per the
// Grappler feat's wording) isn't independently confirmed in this app's rules
// reference data — this endpoint intentionally applies the 2014-confirmed
// mechanic for both editions rather than guessing 2024-specific numbers.
//
// On success, applies the seeded "Grappled" effect_definition (a real SRD
// condition, not a spell-style template) to the target via
// services/effects.ts's applyEncounterEffect — the same DM-only mechanism
// the existing effect-apply dialog already uses, so undo/removal reuses the
// existing DELETE /effects/:id flow with no new plumbing.

import type { Pool } from 'pg';
import { AppError, notFound } from '../middleware/errors.js';
import { rollDice, type DiceRollRow } from './diceRolls.js';
import { requireCurrentTurn } from './encounters.js';
import { canShoveSize } from './shove.js';
import { applyEncounterEffect, type EffectMutationResult } from './effects.js';
import type { PerformGrappleInput } from '../schemas/grapple.js';

function abilityModifier(score: number): number {
  return Math.floor((score - 10) / 2);
}

interface EncounterRow {
  id: string;
  campaign_id: string;
  sync_seq: number;
  [key: string]: unknown;
}

interface ParticipantRow {
  id: string;
  action_used: boolean;
  bonus_action_used: boolean;
  reaction_used: boolean;
  dash_used: boolean;
  movement_used_ft: number;
  object_interaction_used: boolean;
  [key: string]: unknown;
}

export interface GrappleResult {
  encounter: EncounterRow;
  participant: ParticipantRow;
  attackerRoll: DiceRollRow;
  defenderRoll: DiceRollRow | null;
  defenderTotal: number;
  defenderOverridden: boolean;
  success: boolean;
  appliedEffect: EffectMutationResult | null;
  message: string;
}

async function fetchGrappledEffectDefinitionId(pool: Pool): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `SELECT id FROM effect_definitions WHERE name = 'Grappled' AND condition_id IS NOT NULL LIMIT 1`,
  );
  const row = result.rows[0];
  if (!row) throw new AppError('CONFLICT', 'No "Grappled" effect definition found in the catalog — seed effect_definitions first');
  return row.id;
}

export async function performGrapple(
  pool: Pool,
  encounterId: string,
  attackerParticipantId: string,
  actorUserId: string,
  input: PerformGrappleInput,
): Promise<GrappleResult> {
  const client = await pool.connect();
  let campaignId: string;
  let attackerStr: number;
  let attackerCharacterId: string;
  let defenderMonsterInstanceId: string;
  let defenderStr: number;
  let defenderDex: number;
  let defenderSkills: Record<string, number> | null;
  let encounter: EncounterRow;
  let participant: ParticipantRow;

  try {
    await client.query('BEGIN');

    const attackerRes = await client.query<
      {
        id: string;
        character_id: string | null;
        action_used: boolean;
        str: number;
        campaign_id: string;
        turn_order: number;
        status: 'preparing' | 'active' | 'paused' | 'completed';
        current_turn_index: number;
      }
    >(
      `SELECT cp.id, cp.character_id, cp.action_used, cp.turn_order, c.str, e.campaign_id, e.status, e.current_turn_index
       FROM combat_participants cp
       JOIN characters c ON c.id = cp.character_id
       JOIN encounters e ON e.id = cp.encounter_id
       WHERE cp.id = $1 AND cp.encounter_id = $2
       FOR UPDATE OF cp`,
      [attackerParticipantId, encounterId],
    );
    const attackerRow = attackerRes.rows[0];
    if (!attackerRow) throw notFound('Attacker participant (must be a character)');
    if (attackerRow.action_used) {
      throw new AppError('CONFLICT', "That participant's action has already been used this turn");
    }
    requireCurrentTurn(
      { status: attackerRow.status, current_turn_index: attackerRow.current_turn_index },
      { turn_order: attackerRow.turn_order },
    );
    campaignId = attackerRow.campaign_id;
    attackerStr = attackerRow.str;
    attackerCharacterId = attackerRow.character_id!;

    const defenderRes = await client.query<
      { monster_instance_id: string | null; size: string; str: number; dex: number; skills: Record<string, number> | null }
    >(
      `SELECT cp.monster_instance_id, m.size, m.str, m.dex, m.skills
       FROM combat_participants cp
       JOIN monster_instances mi ON mi.id = cp.monster_instance_id
       JOIN monsters m ON m.id = mi.monster_id
       WHERE cp.id = $1 AND cp.encounter_id = $2`,
      [input.targetParticipantId, encounterId],
    );
    const defenderRow = defenderRes.rows[0];
    if (!defenderRow) throw notFound('Target participant (must be an NPC)');
    if (!canShoveSize(defenderRow.size)) {
      throw new AppError(
        'VALIDATION_ERROR',
        `${defenderRow.size} is too large to grapple — target must be no more than one size category larger than the attacker`,
      );
    }
    defenderMonsterInstanceId = defenderRow.monster_instance_id!;
    defenderStr = defenderRow.str;
    defenderDex = defenderRow.dex;
    defenderSkills = defenderRow.skills;

    const updated = await client.query<ParticipantRow>(
      `UPDATE combat_participants SET action_used = true WHERE id = $1 AND encounter_id = $2 RETURNING *`,
      [attackerParticipantId, encounterId],
    );
    participant = updated.rows[0]!;

    const encounterRes = await client.query<EncounterRow>(
      `UPDATE encounters SET sync_seq = sync_seq + 1 WHERE id = $1 RETURNING *`,
      [encounterId],
    );
    encounter = encounterRes.rows[0]!;

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  // ---- Rolls (and, on success, the effect application) happen after the
  // action-economy transaction commits — same reasoning as shove.ts.
  const attackerModifier = abilityModifier(attackerStr);
  const attackerRoll = await rollDice(pool, campaignId, actorUserId, 'dm', {
    rollType: 'skill_check',
    rollContext: 'Grapple (Athletics)',
    keep: 'normal',
    modifier: attackerModifier,
    diceSides: 20,
    diceCount: 1,
    characterId: attackerCharacterId,
    encounterId,
    visibility: 'public' as const,
  });

  const defenderAbilityScore = input.defenderSkill === 'athletics' ? defenderStr : defenderDex;
  const defenderModifier = defenderSkills?.[input.defenderSkill] ?? abilityModifier(defenderAbilityScore);

  let defenderRoll: DiceRollRow | null = null;
  let defenderTotal: number;
  const defenderOverridden = input.defenderRollOverride !== undefined;
  if (defenderOverridden) {
    defenderTotal = input.defenderRollOverride!;
  } else {
    defenderRoll = await rollDice(pool, campaignId, actorUserId, 'dm', {
      rollType: 'skill_check',
      rollContext: input.defenderSkill === 'athletics' ? 'Grapple defense (Athletics)' : 'Grapple defense (Acrobatics)',
      keep: 'normal',
      modifier: defenderModifier,
      diceSides: 20,
      diceCount: 1,
      monsterInstanceId: defenderMonsterInstanceId,
      encounterId,
      visibility: 'public' as const,
    });
    defenderTotal = defenderRoll.result_total;
  }

  const success = attackerRoll.result_total >= defenderTotal;

  let appliedEffect: EffectMutationResult | null = null;
  if (success) {
    const grappledEffectDefinitionId = await fetchGrappledEffectDefinitionId(pool);
    appliedEffect = await applyEncounterEffect(pool, encounterId, campaignId, {
      effectDefinitionId: grappledEffectDefinitionId,
      monsterInstanceId: defenderMonsterInstanceId,
      sourceCharacterId: attackerCharacterId,
      sourceType: 'manual',
    });
  }

  const message = success
    ? 'Grapple succeeds — target is grappled.'
    : 'Grapple fails — target breaks free.';

  return { encounter, participant, attackerRoll, defenderRoll, defenderTotal, defenderOverridden, success, appliedEffect, message };
}

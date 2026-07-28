// Shove Check Against a Specific NPC. Scoped deliberately narrow — attacker
// must be a PC (combat_participants.character_id set) and target must be an
// NPC (monster_instance_id set), matching the feature's own framing rather
// than the general "any participant vs any participant" case nobody asked
// for. Reuses services/diceRolls.ts's rollDice for BOTH sides' d20s (same
// server RNG, same dice_rolls history) instead of duplicating it; the whole
// endpoint is requireEncounterDm-gated (routes/encounters.ts) so passing
// role:'dm' to rollDice is always correct here, regardless of which
// player's PC is attacking.

import type { Pool } from 'pg';
import { AppError, notFound } from '../middleware/errors.js';
import { rollDice, type DiceRollRow } from './diceRolls.js';
import type { PerformShoveInput } from '../schemas/shove.js';

// Self-contained per-file pure helper — same "don't cross-import a one-line
// formula" precedent as services/armorClass.ts's own abilityModifier.
function abilityModifier(score: number): number {
  return Math.floor((score - 10) / 2);
}

// 5e size categories, smallest to largest.
const SIZE_ORDER = ['tiny', 'small', 'medium', 'large', 'huge', 'gargantuan'];
// PCs have no `size` column of their own — this app treats every character
// as Medium (confirmed with the user rather than guessed), so the attacker
// side of the size comparison is always this constant.
const ATTACKER_SIZE_RANK = SIZE_ORDER.indexOf('medium');

function sizeRank(size: string): number {
  const rank = SIZE_ORDER.indexOf(size.toLowerCase());
  return rank === -1 ? ATTACKER_SIZE_RANK : rank; // unrecognized size: don't hard-fail, treat as Medium
}

/** A shove target must be no more than one size category larger than a Medium attacker (5e PHB). */
export function canShoveSize(defenderSize: string): boolean {
  return sizeRank(defenderSize) - ATTACKER_SIZE_RANK <= 1;
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

export interface ShoveResult {
  encounter: EncounterRow;
  participant: ParticipantRow;
  attackerRoll: DiceRollRow;
  defenderRoll: DiceRollRow | null;
  defenderTotal: number;
  defenderOverridden: boolean;
  success: boolean;
  outcome: 'push_5ft' | 'knock_prone' | null;
  message: string;
}

export async function performShove(
  pool: Pool,
  encounterId: string,
  attackerParticipantId: string,
  actorUserId: string,
  input: PerformShoveInput,
): Promise<ShoveResult> {
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
      { id: string; character_id: string | null; action_used: boolean; str: number; campaign_id: string }
    >(
      `SELECT cp.id, cp.character_id, cp.action_used, c.str, e.campaign_id
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
        `${defenderRow.size} is too large to shove — target must be no more than one size category larger than the attacker`,
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

  // ---- Rolls happen after the action-economy transaction commits — same
  // "a single INSERT is already atomic on its own" reasoning
  // services/diceRolls.ts documents for why rollDice doesn't need to join
  // this transaction.
  const attackerModifier = abilityModifier(attackerStr);
  const attackerRoll = await rollDice(pool, campaignId, actorUserId, 'dm', {
    rollType: 'skill_check',
    rollContext: 'Shove (Athletics)',
    keep: 'normal',
    modifier: attackerModifier,
    diceSides: 20,
    diceCount: 1,
    characterId: attackerCharacterId,
    encounterId,
  });

  // Monster stat blocks list the SKILL's final total bonus directly when the
  // creature is proficient in it (m.skills), not a proficiency flag to
  // recombine with an ability mod — falling back to the plain ability
  // modifier when absent is correct 5e RAW for a non-proficient monster, not
  // just a simplification.
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
      rollContext: input.defenderSkill === 'athletics' ? 'Shove defense (Athletics)' : 'Shove defense (Acrobatics)',
      keep: 'normal',
      modifier: defenderModifier,
      diceSides: 20,
      diceCount: 1,
      monsterInstanceId: defenderMonsterInstanceId,
      encounterId,
    });
    defenderTotal = defenderRoll.result_total;
  }

  const success = attackerRoll.result_total >= defenderTotal;
  const outcome = success ? input.desiredEffect : null;
  const message = success
    ? input.desiredEffect === 'push_5ft'
      ? 'Shove succeeds — target is pushed 5 feet away.'
      : 'Shove succeeds — target is knocked prone.'
    : 'Shove fails — target holds its ground.';

  return { encounter, participant, attackerRoll, defenderRoll, defenderTotal, defenderOverridden, success, outcome, message };
}

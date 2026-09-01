// docs/roadmap/dnd-2024-gap-analysis.md P3-3 (ER-08) — service layer for the
// four environmental hazards (Burning, Dehydration, Malnutrition, Suffocation).
//
// Scope (confirmed with the user first, P3 items being gated on Open Question
// 4): stateless calculators (domain/hazards.ts) plus thin advisory endpoints.
// The end-of-day (Dehydration/Malnutrition) and suffocation resolutions
// AUTO-WRITE the computed Exhaustion delta to characters.exhaustion_level in
// the same transaction (the user's explicit choice), matching P2-4's Long
// Rest auto-reduction and fallDamage's auto-applied damage rather than
// P3-2's forced-march "report the schedule only". Everything else stays
// compute-and-suggest: nothing rolls a d20 here (the DM rolls the Con saves
// via the existing dice endpoint; this only RE-DERIVES the outcome from the
// stored row, never trusting a client boolean — P1-12's invariant), nothing
// flips characters.is_alive even when Exhaustion hits the lethal level 6
// (see the "Not done" note in the progress log — matches the existing manual
// updateExhaustion endpoint, which also never does).
//
// No migration: this reuses characters.exhaustion_level, the apply-damage
// pipeline, and active_effects.stack_count (the same mechanism P2-6 already
// uses to track a monster's Exhaustion level) — plus two seed-only
// effect_definitions templates ("Burning", "Suffocating").

import type { Pool, PoolClient } from 'pg';
import { AppError, notFound } from '../middleware/errors.js';
import { requireDm, requireMembership } from './authz.js';
import { abilityModifier } from './armorClass.js';
import { deriveSaveOutcomeSucceeded } from './diceRolls.js';
import { applyDamage, type ApplyDamageResult } from './characters.js';
import { applyMonsterInstanceDamage, type ApplyMonsterInstanceDamageResult } from './monsters.js';
import type { PendingActionCreated } from './pendingActions.js';
import {
  applyExhaustionDelta,
  burningTick,
  dehydrationOutcome,
  malnutritionOutcome,
  suffocationOutcome,
  type CreatureSize,
  type DailyHazardOutcome,
  type ExhaustionDelta,
  type HazardEdition,
  type SuffocationOutcome,
} from '../domain/hazards.js';
import type { ResolveDailyHazardsInput, SuffocationTickInput } from '../schemas/hazards.js';

async function campaignEdition(pool: Pool | PoolClient, campaignId: string): Promise<HazardEdition> {
  const res = await pool.query<{ srd_edition: HazardEdition }>(`SELECT srd_edition FROM campaigns WHERE id = $1`, [campaignId]);
  const edition = res.rows[0]?.srd_edition;
  if (!edition) throw notFound('Campaign');
  return edition;
}

async function fetchEffectDefinitionIdByName(pool: Pool | PoolClient, name: string): Promise<string> {
  const res = await pool.query<{ id: string }>(
    `SELECT id FROM effect_definitions WHERE name = $1 AND is_homebrew = false LIMIT 1`,
    [name],
  );
  const row = res.rows[0];
  if (!row) throw new AppError('CONFLICT', `No "${name}" effect definition found in the catalog — seed effect_definitions first`);
  return row.id;
}

// --------------------------------------------------------------------------
// Burning — 1d4 Fire per turn through the normal apply-damage pipeline.
// --------------------------------------------------------------------------

export interface BurningTickResult {
  encounterId: string;
  campaignId: string;
  participantId: string;
  characterId: string | null;
  monsterInstanceId: string | null;
  edition: HazardEdition;
  diceCount: number;
  diceSides: number;
  appliedDamage: number;
  endConditions: string[];
  notes: string[];
  damage: ApplyDamageResult | ApplyMonsterInstanceDamageResult;
}

/**
 * Resolve one turn's worth of Burning damage on a participant. Mirrors
 * services/fallDamage.ts's performFallDamage almost exactly (fixed dice, no
 * distance, no save): looks up the participant, requires an active "Burning"
 * effect (burning damage without being on fire is nonsensical — the error
 * tells the DM to apply the effect first, same guard-rail style as
 * weaponMastery's "you haven't chosen that mastery"), then applies 1d4 Fire
 * via the existing pipeline so Fire Resistance/Vulnerability/Immunity,
 * temp-HP absorption, and the death-save/massive-damage/unconscious
 * transitions all apply exactly as for any other hit.
 */
export async function performBurningTick(
  pool: Pool,
  encounterId: string,
  participantId: string,
  actorId: string,
): Promise<BurningTickResult | PendingActionCreated> {
  const participantRes = await pool.query<{
    id: string; character_id: string | null; monster_instance_id: string | null; campaign_id: string;
  }>(
    `SELECT cp.id, cp.character_id, cp.monster_instance_id, e.campaign_id
     FROM combat_participants cp JOIN encounters e ON e.id = cp.encounter_id
     WHERE cp.id = $1 AND cp.encounter_id = $2`,
    [participantId, encounterId],
  );
  const participant = participantRes.rows[0];
  if (!participant) throw notFound('Participant');

  const column = participant.character_id != null ? 'character_id' : 'monster_instance_id';
  const targetId = participant.character_id ?? participant.monster_instance_id;
  const burningRes = await pool.query<{ id: string }>(
    `SELECT ae.id FROM active_effects ae JOIN effect_definitions ed ON ed.id = ae.effect_definition_id
     WHERE ae.${column} = $1 AND ae.removed_at IS NULL AND ed.name = 'Burning' LIMIT 1`,
    [targetId],
  );
  if (burningRes.rows.length === 0) {
    throw new AppError('CONFLICT', 'That participant has no active "Burning" effect — apply the Burning effect first, then resolve its per-turn damage here');
  }

  const edition = await campaignEdition(pool, participant.campaign_id);
  const tick = burningTick(edition);

  const damageInput = {
    diceSides: tick.diceSides as 4,
    diceCount: tick.diceCount,
    modifier: 0,
    damageType: tick.damageType,
    isCritical: false,
    encounterId,
    rollContext: 'Burning',
  };

  const damage = participant.character_id
    ? await applyDamage(pool, actorId, participant.character_id, damageInput)
    : await applyMonsterInstanceDamage(pool, actorId, participant.monster_instance_id!, damageInput);

  // Unreachable in practice (no attackerParticipantId is sent) — same
  // defensive branch as fallDamage.
  if ('pending' in damage) return damage;

  return {
    encounterId,
    campaignId: participant.campaign_id,
    participantId,
    characterId: participant.character_id,
    monsterInstanceId: participant.monster_instance_id,
    edition,
    diceCount: tick.diceCount,
    diceSides: tick.diceSides,
    appliedDamage: damage.appliedDamage,
    endConditions: tick.endConditions,
    notes: tick.notes,
    damage,
  };
}

// --------------------------------------------------------------------------
// Dehydration + Malnutrition — end-of-day, campaign-scoped, DM-only.
// --------------------------------------------------------------------------

export interface DailyHazardCharacterResult {
  characterId: string;
  edition: HazardEdition;
  dehydration: DailyHazardOutcome | null;
  malnutrition: DailyHazardOutcome | null;
  exhaustion: ExhaustionDelta;
}

export interface ResolveDailyHazardsResult {
  campaignId: string;
  resolved: DailyHazardCharacterResult[];
}

interface CharacterRestRow {
  id: string;
  campaign_id: string;
  exhaustion_level: number;
  con: number;
  is_alive: boolean;
}

export async function resolveDailyHazards(
  pool: Pool,
  actorId: string,
  campaignId: string,
  input: ResolveDailyHazardsInput,
): Promise<ResolveDailyHazardsResult> {
  requireDm(await requireMembership(pool, campaignId, actorId));
  const edition = await campaignEdition(pool, campaignId);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const resolved: DailyHazardCharacterResult[] = [];

    for (const entry of input.entries) {
      const charRes = await client.query<CharacterRestRow>(
        `SELECT id, campaign_id, exhaustion_level, con, is_alive
         FROM characters WHERE id = $1 AND campaign_id = $2 FOR UPDATE`,
        [entry.characterId, campaignId],
      );
      const character = charRes.rows[0];
      if (!character) throw notFound(`Character ${entry.characterId}`);

      const size: CreatureSize = entry.size ?? 'medium';
      const conMod = abilityModifier(character.con);

      let dehydration: DailyHazardOutcome | null = null;
      if (entry.water) {
        // 2014 dehydration's DC 15 Con save (only reached when at least half
        // but not the full requirement was consumed).
        const saveSucceeded = await deriveSaveOutcomeSucceeded(client, campaignId, entry.water.saveRollId, 15);
        dehydration = dehydrationOutcome({
          edition,
          size,
          gallonsConsumed: entry.water.gallonsConsumed,
          hotWeather: entry.water.hotWeather,
          currentExhaustionLevel: character.exhaustion_level,
          saveSucceeded,
        });
      }

      let malnutrition: DailyHazardOutcome | null = null;
      if (entry.food) {
        // 2024 malnutrition's DC 10 Con save (only reached when the creature
        // ate something but less than half).
        const saveSucceeded = await deriveSaveOutcomeSucceeded(client, campaignId, entry.food.saveRollId, 10);
        malnutrition = malnutritionOutcome({
          edition,
          size,
          poundsConsumed: entry.food.poundsConsumed,
          consecutiveDaysWithoutFood: entry.food.consecutiveDaysWithoutFood,
          conModifier: conMod,
          saveSucceeded,
        });
      }

      const totalGained =
        (dehydration?.exhaustionLevelsGained ?? 0) + (malnutrition?.exhaustionLevelsGained ?? 0);
      const exhaustion = applyExhaustionDelta(character.exhaustion_level, totalGained);

      if (exhaustion.applied !== 0) {
        await client.query(
          `UPDATE characters SET exhaustion_level = $1, updated_at = now() WHERE id = $2`,
          [exhaustion.after, character.id],
        );
      }

      resolved.push({ characterId: character.id, edition, dehydration, malnutrition, exhaustion });
    }

    await client.query('COMMIT');
    return { campaignId, resolved };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// --------------------------------------------------------------------------
// Suffocation — per-turn, encounter-scoped, character participants only.
// --------------------------------------------------------------------------

export interface SuffocationTickResult {
  encounterId: string;
  campaignId: string;
  participantId: string;
  characterId: string;
  edition: HazardEdition;
  outcome: SuffocationOutcome;
  /** 2024 only — Exhaustion write for this tick (or the reversal on breathing again). */
  exhaustion: ExhaustionDelta | null;
  /** Running total of Exhaustion this suffocation episode has accrued (2024). */
  suffocationExhaustionAccrued: number;
  /** Set on the tick that resolves "can breathe again" and removed the tracking effect. */
  suffocationExhaustionRemoved: number | null;
  /** The "Suffocating" ledger effect row, when created/updated this tick. */
  effect: Record<string, unknown> | null;
  effectRemovedId: string | null;
}

export async function performSuffocationTick(
  pool: Pool,
  encounterId: string,
  participantId: string,
  _actorId: string,
  input: SuffocationTickInput,
): Promise<SuffocationTickResult> {
  const participantRes = await pool.query<{
    id: string; character_id: string | null; campaign_id: string;
  }>(
    `SELECT cp.id, cp.character_id, e.campaign_id
     FROM combat_participants cp JOIN encounters e ON e.id = cp.encounter_id
     WHERE cp.id = $1 AND cp.encounter_id = $2`,
    [participantId, encounterId],
  );
  const participant = participantRes.rows[0];
  if (!participant) throw notFound('Participant');
  if (!participant.character_id) {
    throw new AppError(
      'CONFLICT',
      'Suffocation tracking here is for character participants only. A monster instance has no exhaustion_level column — the DM tracks a suffocating monster via a manual "Exhaustion" effect (its stack_count is the level), same as every other monster-Exhaustion case in this app.',
    );
  }

  const edition = await campaignEdition(pool, participant.campaign_id);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const charRes = await client.query<{ id: string; con: number; exhaustion_level: number }>(
      `SELECT id, con, exhaustion_level FROM characters WHERE id = $1 FOR UPDATE`,
      [participant.character_id],
    );
    const character = charRes.rows[0];
    if (!character) throw notFound('Character');

    const outcome = suffocationOutcome({ edition, conModifier: abilityModifier(character.con) });

    // The "Suffocating" effect row is this episode's Exhaustion-accrual
    // ledger: its stack_count is how many levels THIS suffocation caused, so
    // "when it can breathe again it removes all levels it gained from
    // suffocating" (rulesGlossary.md:1553) can be honoured without a
    // per-source Exhaustion model on the character.
    const suffocatingRes = await client.query<{ id: string; stack_count: number | null }>(
      `SELECT ae.id, ae.stack_count FROM active_effects ae
       JOIN effect_definitions ed ON ed.id = ae.effect_definition_id
       WHERE ae.character_id = $1 AND ae.removed_at IS NULL AND ed.name = 'Suffocating'
       ORDER BY ae.created_at ASC LIMIT 1`,
      [character.id],
    );
    const existing = suffocatingRes.rows[0] ?? null;
    const accruedSoFar = existing?.stack_count ?? 0;

    // 2014: no Exhaustion interaction at all — report-only. If a stale
    // "Suffocating" effect exists (edition switched mid-episode, say), clear
    // it, but never touch exhaustion_level.
    if (edition === '2014') {
      let effectRemovedId: string | null = null;
      if (existing && input.canBreatheAgain) {
        await client.query(`UPDATE active_effects SET removed_at = now() WHERE id = $1`, [existing.id]);
        effectRemovedId = existing.id;
      }
      await client.query('COMMIT');
      return {
        encounterId,
        campaignId: participant.campaign_id,
        participantId,
        characterId: character.id,
        edition,
        outcome,
        exhaustion: null,
        suffocationExhaustionAccrued: input.canBreatheAgain ? 0 : accruedSoFar,
        suffocationExhaustionRemoved: null,
        effect: null,
        effectRemovedId,
      };
    }

    // 2024
    if (input.canBreatheAgain) {
      if (!existing) {
        await client.query('COMMIT');
        return {
          encounterId,
          campaignId: participant.campaign_id,
          participantId,
          characterId: character.id,
          edition,
          outcome,
          exhaustion: null,
          suffocationExhaustionAccrued: 0,
          suffocationExhaustionRemoved: 0,
          effect: null,
          effectRemovedId: null,
        };
      }
      const exhaustion = applyExhaustionDelta(character.exhaustion_level, -accruedSoFar);
      if (exhaustion.applied !== 0) {
        await client.query(`UPDATE characters SET exhaustion_level = $1, updated_at = now() WHERE id = $2`, [
          exhaustion.after,
          character.id,
        ]);
      }
      await client.query(`UPDATE active_effects SET removed_at = now() WHERE id = $1`, [existing.id]);
      await client.query('COMMIT');
      return {
        encounterId,
        campaignId: participant.campaign_id,
        participantId,
        characterId: character.id,
        edition,
        outcome,
        exhaustion,
        suffocationExhaustionAccrued: 0,
        suffocationExhaustionRemoved: accruedSoFar,
        effect: null,
        effectRemovedId: existing.id,
      };
    }

    // A tick out of breath: +1 Exhaustion at the end of the turn.
    const exhaustion = applyExhaustionDelta(character.exhaustion_level, outcome.exhaustionPerTurn);
    if (exhaustion.applied !== 0) {
      await client.query(`UPDATE characters SET exhaustion_level = $1, updated_at = now() WHERE id = $2`, [
        exhaustion.after,
        character.id,
      ]);
    }

    // The "Suffocating" ledger row is a plain active_effects row (no
    // concentration, no encounter sync, no auto-replace) — a direct
    // INSERT/UPDATE in this same transaction rather than routing through
    // insertActiveEffect's spell-effect machinery, which none of it needs.
    const newAccrued = accruedSoFar + exhaustion.applied;
    let effect: Record<string, unknown> | null = null;
    if (existing) {
      const upd = await client.query(`UPDATE active_effects SET stack_count = $1 WHERE id = $2 RETURNING *`, [
        newAccrued,
        existing.id,
      ]);
      effect = upd.rows[0] ?? null;
    } else {
      const definitionId = await fetchEffectDefinitionIdByName(client, 'Suffocating');
      const ins = await client.query(
        `INSERT INTO active_effects
           (effect_definition_id, character_id, monster_instance_id, encounter_id, source_type,
            duration_type, duration_value, stack_count, concentration, notes)
         VALUES ($1, $2, NULL, $3, 'manual', 'until_removed', NULL, $4, false, $5)
         RETURNING *`,
        [
          definitionId,
          character.id,
          encounterId,
          newAccrued,
          'Exhaustion accrued from this suffocation episode; removed in full when the creature can breathe again.',
        ],
      );
      effect = ins.rows[0] ?? null;
    }

    await client.query('COMMIT');
    return {
      encounterId,
      campaignId: participant.campaign_id,
      participantId,
      characterId: character.id,
      edition,
      outcome,
      exhaustion,
      suffocationExhaustionAccrued: newAccrued,
      suffocationExhaustionRemoved: null,
      effect,
      effectRemovedId: null,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

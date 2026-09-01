// docs/roadmap/dnd-2024-gap-analysis.md P3-3 (ER-08) — the environmental-
// hazard services against a live DB. Pure rule math is covered in
// domain/hazards.test.ts; this file proves the wiring: the campaign's
// srd_edition really drives the branch, the DC 10 / DC 15 Con saves are
// re-derived from a stored dice_rolls row (never a client boolean), the
// computed Exhaustion delta is actually written to characters.exhaustion_level
// and clamped at 6, Burning reuses the apply-damage pipeline (Fire Resistance
// and all), and Suffocation's "remove all Exhaustion it gained from
// suffocating" is honoured via the "Suffocating" ledger effect's stack_count.
// Throwaway fixtures, same isolation convention as fallDamage.integration.test.ts.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../db/pool.js';
import { addParticipant, createEncounter } from './encounters.js';
import { createHomebrewMonster } from './monsterCatalog.js';
import { performBurningTick, performSuffocationTick, resolveDailyHazards } from './hazards.js';

describe('environmental hazards (integration, live DB, throwaway fixtures)', () => {
  let dmUserId: string;
  let campaign2024Id: string;
  let campaign2014Id: string;
  let encounter2024Id: string;
  let encounter2014Id: string;
  let monster2024Id: string;
  let burningEffectDefId: string;

  beforeAll(async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const dmRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'Hazards Test DM', 'x') RETURNING id`,
      [`hazards-test-dm-${suffix}@example.test`],
    );
    dmUserId = dmRes.rows[0]!.id;

    for (const edition of ['2024', '2014'] as const) {
      const campaignRes = await pool.query<{ id: string }>(
        `INSERT INTO campaigns (name, dm_user_id, srd_edition) VALUES ($1, $2, $3) RETURNING id`,
        [`Hazards ${edition}`, dmUserId, edition],
      );
      const campaignId = campaignRes.rows[0]!.id;
      await pool.query(`INSERT INTO campaign_members (campaign_id, user_id, role) VALUES ($1, $2, 'dm')`, [campaignId, dmUserId]);
      const encounter = await createEncounter(pool, campaignId, { name: `Hazards ${edition} Encounter` });
      await pool.query(`UPDATE encounters SET status = 'active', current_turn_index = 0 WHERE id = $1`, [encounter.id]);
      if (edition === '2024') {
        campaign2024Id = campaignId;
        encounter2024Id = encounter.id;
      } else {
        campaign2014Id = campaignId;
        encounter2014Id = encounter.id;
      }
    }

    const monster = await createHomebrewMonster(pool, campaign2024Id, dmUserId, {
      name: 'Hazards Test Beast', size: 'medium', creatureType: 'beast', armorClass: 12, hitPointAverage: 300,
      hitDice: '12d8', speed: { walk: 30 }, str: 12, dex: 12, con: 12, int: 4, wis: 10, cha: 6,
      challengeRating: 1, xpValue: 200, actions: [{ name: 'Slam', description: '1d4 bludgeoning.' }],
    });
    await pool.query(`INSERT INTO campaign_bestiary_entries (campaign_id, monster_id) VALUES ($1, $2)`, [campaign2024Id, monster.id]);
    monster2024Id = monster.id;

    const burningRes = await pool.query<{ id: string }>(
      `SELECT id FROM effect_definitions WHERE name = 'Burning' AND is_homebrew = false`,
    );
    if (!burningRes.rows[0]) throw new Error("Expected a seeded 'Burning' effect_definitions row");
    burningEffectDefId = burningRes.rows[0].id;
  });

  afterAll(async () => {
    for (const id of [campaign2024Id, campaign2014Id]) {
      if (id) await pool.query(`DELETE FROM campaigns WHERE id = $1`, [id]);
    }
    if (dmUserId) await pool.query(`DELETE FROM users WHERE id = $1`, [dmUserId]);
    await pool.end();
  });

  async function makeCharacter(
    campaignId: string,
    opts: { con?: number; exhaustion?: number; hpMax?: number; damageResistances?: string[] } = {},
  ): Promise<string> {
    const res = await pool.query<{ id: string }>(
      `INSERT INTO characters
         (campaign_id, is_pc, owner_user_id, created_by_user_id, name, str, dex, con, int, wis, cha,
          armor_class, speed, hp_max, hp_current, exhaustion_level, damage_resistances)
       VALUES ($1, true, $2, $2, $3, 10, 10, $4, 10, 10, 10, 12, 30, $5, $5, $6, $7)
       RETURNING id`,
      [
        campaignId,
        dmUserId,
        `Hazard PC ${Math.random().toString(36).slice(2)}`,
        opts.con ?? 10,
        opts.hpMax ?? 200,
        opts.exhaustion ?? 0,
        opts.damageResistances ?? [],
      ],
    );
    return res.rows[0]!.id;
  }

  async function seatCharacter(encounterId: string, characterId: string): Promise<string> {
    const { participant } = await addParticipant(pool, encounterId, { characterId, initiativeRoll: 10 });
    return participant.id;
  }

  async function exhaustionOf(characterId: string): Promise<number> {
    const res = await pool.query<{ exhaustion_level: number }>(`SELECT exhaustion_level FROM characters WHERE id = $1`, [characterId]);
    return res.rows[0]!.exhaustion_level;
  }

  async function insertSavingThrowRoll(campaignId: string, total: number): Promise<string> {
    const res = await pool.query<{ id: string }>(
      `INSERT INTO dice_rolls (campaign_id, user_id, roll_type, d20_rolls, keep, dice_sides, dice_count, modifier, result_total)
       VALUES ($1, $2, 'saving_throw', ARRAY[$3::int], 'normal', 20, 1, 0, $3) RETURNING id`,
      [campaignId, dmUserId, total],
    );
    return res.rows[0]!.id;
  }

  // -- resolve-daily (Dehydration + Malnutrition) --------------------------

  it('2024: drinking less than half the day\'s water writes +1 Exhaustion, no save', async () => {
    const characterId = await makeCharacter(campaign2024Id);
    const result = await resolveDailyHazards(pool, dmUserId, campaign2024Id, {
      entries: [{ characterId, water: { gallonsConsumed: 0.2 } }],
    });
    expect(result.resolved[0]!.dehydration!.exhaustionLevelsGained).toBe(1);
    expect(result.resolved[0]!.exhaustion).toMatchObject({ before: 0, after: 1 });
    expect(await exhaustionOf(characterId)).toBe(1);
  });

  it('2024: malnutrition DC 10 Con save is re-derived from a stored dice_rolls row', async () => {
    const failCharId = await makeCharacter(campaign2024Id);
    const passCharId = await makeCharacter(campaign2024Id);
    const failedRoll = await insertSavingThrowRoll(campaign2024Id, 8); // < 10
    const passedRoll = await insertSavingThrowRoll(campaign2024Id, 14); // >= 10

    const failRes = await resolveDailyHazards(pool, dmUserId, campaign2024Id, {
      entries: [{ characterId: failCharId, food: { poundsConsumed: 0.25, saveRollId: failedRoll } }],
    });
    expect(failRes.resolved[0]!.malnutrition!.saveSucceeded).toBe(false);
    expect(await exhaustionOf(failCharId)).toBe(1);

    const passRes = await resolveDailyHazards(pool, dmUserId, campaign2024Id, {
      entries: [{ characterId: passCharId, food: { poundsConsumed: 0.25, saveRollId: passedRoll } }],
    });
    expect(passRes.resolved[0]!.malnutrition!.saveSucceeded).toBe(true);
    expect(await exhaustionOf(passCharId)).toBe(0);
  });

  it('2014: an already-exhausted character takes 2 dehydration levels, not 1', async () => {
    const characterId = await makeCharacter(campaign2014Id, { exhaustion: 2 });
    await resolveDailyHazards(pool, dmUserId, campaign2014Id, {
      entries: [{ characterId, water: { gallonsConsumed: 0 } }],
    });
    expect(await exhaustionOf(characterId)).toBe(4);
  });

  it('the Exhaustion write is clamped at level 6', async () => {
    const characterId = await makeCharacter(campaign2014Id, { exhaustion: 5 });
    const result = await resolveDailyHazards(pool, dmUserId, campaign2014Id, {
      entries: [{ characterId, water: { gallonsConsumed: 0 }, food: { poundsConsumed: 0, consecutiveDaysWithoutFood: 20, saveRollId: undefined } }],
    });
    expect(result.resolved[0]!.exhaustion.reachedLethalLevel).toBe(true);
    expect(await exhaustionOf(characterId)).toBe(6);
  });

  it('a well-fed, well-watered character gains nothing and its row is untouched', async () => {
    const characterId = await makeCharacter(campaign2024Id, { exhaustion: 1 });
    await resolveDailyHazards(pool, dmUserId, campaign2024Id, {
      entries: [{ characterId, water: { gallonsConsumed: 1 }, food: { poundsConsumed: 1 } }],
    });
    expect(await exhaustionOf(characterId)).toBe(1);
  });

  // -- Burning ------------------------------------------------------------

  it('burning-tick requires an active "Burning" effect, then applies 1d4 Fire through the damage pipeline', async () => {
    const characterId = await makeCharacter(campaign2024Id, { hpMax: 100 });
    const participantId = await seatCharacter(encounter2024Id, characterId);

    await expect(performBurningTick(pool, encounter2024Id, participantId, dmUserId)).rejects.toThrow(/Burning/i);

    await pool.query(
      `INSERT INTO active_effects (effect_definition_id, character_id, encounter_id, source_type, duration_type, concentration)
       VALUES ($1, $2, $3, 'manual', 'until_removed', false)`,
      [burningEffectDefId, characterId, encounter2024Id],
    );

    const result = await performBurningTick(pool, encounter2024Id, participantId, dmUserId);
    if ('pending' in result) throw new Error('unexpected pending');
    expect(result).toMatchObject({ diceCount: 1, diceSides: 4, edition: '2024' });
    expect(result.appliedDamage).toBeGreaterThanOrEqual(1);
    expect(result.appliedDamage).toBeLessThanOrEqual(4);
    expect(await exhaustionOf(characterId)).toBe(0); // Burning is HP, never Exhaustion
  });

  it('burning-tick respects Fire Resistance (via the shared apply-damage pipeline)', async () => {
    const characterId = await makeCharacter(campaign2024Id, { hpMax: 100, damageResistances: ['fire'] });
    const participantId = await seatCharacter(encounter2024Id, characterId);
    await pool.query(
      `INSERT INTO active_effects (effect_definition_id, character_id, encounter_id, source_type, duration_type, concentration)
       VALUES ($1, $2, $3, 'manual', 'until_removed', false)`,
      [burningEffectDefId, characterId, encounter2024Id],
    );
    const result = await performBurningTick(pool, encounter2024Id, participantId, dmUserId);
    if ('pending' in result) throw new Error('unexpected pending');
    expect(result.damage.breakdown.resistanceApplied).toBe(true);
    expect(result.appliedDamage).toBeLessThanOrEqual(2); // floor(1d4 / 2)
  });

  // -- Suffocation -------------------------------------------------------

  it('2024: each tick out of breath adds 1 Exhaustion, and breathing again removes exactly what suffocation caused', async () => {
    const characterId = await makeCharacter(campaign2024Id, { con: 10, exhaustion: 1 }); // 1 pre-existing level from elsewhere
    const participantId = await seatCharacter(encounter2024Id, characterId);

    await performSuffocationTick(pool, encounter2024Id, participantId, dmUserId, { canBreatheAgain: false });
    await performSuffocationTick(pool, encounter2024Id, participantId, dmUserId, { canBreatheAgain: false });
    const third = await performSuffocationTick(pool, encounter2024Id, participantId, dmUserId, { canBreatheAgain: false });
    expect(third.suffocationExhaustionAccrued).toBe(3);
    expect(await exhaustionOf(characterId)).toBe(4); // 1 pre-existing + 3 suffocation

    const relief = await performSuffocationTick(pool, encounter2024Id, participantId, dmUserId, { canBreatheAgain: true });
    expect(relief.suffocationExhaustionRemoved).toBe(3);
    expect(await exhaustionOf(characterId)).toBe(1); // back to just the pre-existing level

    const effectRows = await pool.query(
      `SELECT ae.id FROM active_effects ae JOIN effect_definitions ed ON ed.id = ae.effect_definition_id
       WHERE ae.character_id = $1 AND ed.name = 'Suffocating' AND ae.removed_at IS NULL`,
      [characterId],
    );
    expect(effectRows.rows).toHaveLength(0);
  });

  it('2014: suffocation is report-only — no Exhaustion is written', async () => {
    const characterId = await makeCharacter(campaign2014Id, { con: 16 });
    const participantId = await seatCharacter(encounter2014Id, characterId);
    const result = await performSuffocationTick(pool, encounter2014Id, participantId, dmUserId, { canBreatheAgain: false });
    expect(result.edition).toBe('2014');
    expect(result.exhaustion).toBeNull();
    expect(result.outcome).toMatchObject({ exhaustionPerTurn: 0, roundsBeforeDropTo0Hp: 3 });
    expect(await exhaustionOf(characterId)).toBe(0);
  });

  it('suffocation-tick rejects a monster-instance participant', async () => {
    const instanceRes = await pool.query<{ id: string }>(
      `INSERT INTO monster_instances (campaign_id, monster_id, hp_current) VALUES ($1, $2, 300) RETURNING id`,
      [campaign2024Id, monster2024Id],
    );
    const { participant } = await addParticipant(pool, encounter2024Id, { monsterInstanceId: instanceRes.rows[0]!.id, initiativeRoll: 5 });
    await expect(
      performSuffocationTick(pool, encounter2024Id, participant.id, dmUserId, { canBreatheAgain: false }),
    ).rejects.toThrow(/character participants only/i);
  });
});

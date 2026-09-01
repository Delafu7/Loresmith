// Integration test for docs/roadmap/dnd-2024-gap-analysis.md P2-2 (CB-07) —
// proves the actual DB wiring (getCharacterConditionEffects/
// getMonsterInstanceConditionEffects: looking up real active_effects rows
// and a real exhaustion_level/stack_count, then handing off to the pure
// rules table), not just the pure conditionEffects.ts functions
// (conditionEffects.test.ts already covers those in isolation). Throwaway
// campaign/character/monster-instance fixtures, same isolation convention as
// effects.concentration.integration.test.ts.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../db/pool.js';
import { applyCharacterEffect, applyMonsterInstanceEffect, getCharacterConditionEffects, getMonsterInstanceConditionEffects } from './effects.js';
import { createHomebrewMonster } from './monsterCatalog.js';

describe('condition effects report (integration, live DB, throwaway fixtures)', () => {
  let dmUserId: string;
  let campaignId: string;
  let characterId: string;
  let monsterInstanceId: string;
  let proneEffectDefinitionId: string;
  let poisonedEffectDefinitionId: string;
  let exhaustionEffectDefinitionId: string;

  beforeAll(async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const dmRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'ConditionEffects Test DM', 'x') RETURNING id`,
      [`condition-effects-dm-${suffix}@example.test`],
    );
    dmUserId = dmRes.rows[0]!.id;

    const campaignRes = await pool.query<{ id: string }>(
      `INSERT INTO campaigns (name, dm_user_id, srd_edition) VALUES ('ConditionEffects Test Campaign', $1, '2024') RETURNING id`,
      [dmUserId],
    );
    campaignId = campaignRes.rows[0]!.id;
    await pool.query(`INSERT INTO campaign_members (campaign_id, user_id, role) VALUES ($1, $2, 'dm')`, [campaignId, dmUserId]);

    const characterRes = await pool.query<{ id: string }>(
      `INSERT INTO characters
         (campaign_id, is_pc, owner_user_id, created_by_user_id, name, str, dex, con, int, wis, cha,
          armor_class, speed, hp_max, hp_current)
       VALUES ($1, true, $2, $2, 'ConditionEffects Test PC', 10, 10, 10, 10, 10, 10, 12, 30, 10, 10)
       RETURNING id`,
      [campaignId, dmUserId],
    );
    characterId = characterRes.rows[0]!.id;

    const monster = await createHomebrewMonster(pool, campaignId, dmUserId, {
      name: 'ConditionEffects Test Monster', size: 'medium', creatureType: 'beast', armorClass: 12, hitPointAverage: 10,
      hitDice: '2d8', speed: { walk: 30 }, str: 10, dex: 10, con: 10, int: 4, wis: 10, cha: 4,
      challengeRating: 1, xpValue: 200, actions: [{ name: 'Bite', description: '1d4 piercing.' }],
    });
    const instanceRes = await pool.query<{ id: string }>(
      `INSERT INTO monster_instances (campaign_id, monster_id, hp_current) VALUES ($1, $2, 10) RETURNING id`,
      [campaignId, monster.id],
    );
    monsterInstanceId = instanceRes.rows[0]!.id;

    for (const [name, setter] of [
      ['Prone', (id: string) => { proneEffectDefinitionId = id; }],
      ['Poisoned', (id: string) => { poisonedEffectDefinitionId = id; }],
      ['Exhaustion', (id: string) => { exhaustionEffectDefinitionId = id; }],
    ] as const) {
      const res = await pool.query<{ id: string }>(`SELECT id FROM effect_definitions WHERE name = $1 AND is_homebrew = false`, [name]);
      if (!res.rows[0]) throw new Error(`Expected a seeded '${name}' effect_definitions row for this test`);
      setter(res.rows[0]!.id);
    }
  });

  afterAll(async () => {
    if (campaignId) await pool.query(`DELETE FROM campaigns WHERE id = $1`, [campaignId]);
    if (dmUserId) await pool.query(`DELETE FROM users WHERE id = $1`, [dmUserId]);
    await pool.end();
  });

  it('no active conditions: every category comes back empty/clean', async () => {
    const freshRes = await pool.query<{ id: string }>(
      `INSERT INTO characters
         (campaign_id, is_pc, owner_user_id, created_by_user_id, name, str, dex, con, int, wis, cha,
          armor_class, speed, hp_max, hp_current)
       VALUES ($1, true, $2, $2, 'ConditionEffects Fresh PC', 10, 10, 10, 10, 10, 10, 12, 30, 10, 10)
       RETURNING id`,
      [campaignId, dmUserId],
    );
    const report = await getCharacterConditionEffects(pool, dmUserId, freshRes.rows[0]!.id);
    expect(report.conditions).toEqual([]);
    expect(report.exhaustionLevel).toBe(0);
    expect(report.exhaustionPenalty).toBe(0);
    expect(report.ownAttackRolls.disadvantageSources).toEqual([]);
    expect(report.savingThrows.dex.autoFail).toBe(false);
  });

  it('a Prone + Poisoned character reports correctly across every category', async () => {
    await applyCharacterEffect(pool, dmUserId, characterId, { effectDefinitionId: proneEffectDefinitionId, sourceType: 'manual' });
    await applyCharacterEffect(pool, dmUserId, characterId, { effectDefinitionId: poisonedEffectDefinitionId, sourceType: 'manual' });

    const report = await getCharacterConditionEffects(pool, dmUserId, characterId);
    expect(report.conditions.sort()).toEqual(['poisoned', 'prone']);
    // Own attacks: Disadvantage from both Prone and Poisoned.
    expect(report.ownAttackRolls.disadvantageSources.sort()).toEqual(['poisoned', 'prone']);
    // Attacks against them: Advantage in melee, Disadvantage at range, from Prone only.
    expect(report.attacksAgainstThemMelee.advantageSources).toEqual(['prone']);
    expect(report.attacksAgainstThemRanged.disadvantageSources).toEqual(['prone']);
    // Ability checks: Disadvantage from Poisoned only.
    expect(report.abilityChecks.disadvantageSources).toEqual(['poisoned']);
    // Prone/Poisoned neither auto-fails nor disadvantages any saving throw.
    for (const ability of ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const) {
      expect(report.savingThrows[ability].autoFail).toBe(false);
      expect(report.savingThrows[ability].disadvantageSources).toEqual([]);
    }
  });

  it("exhaustion_level drives the flat penalty, independent of the character's other active conditions", async () => {
    await pool.query(`UPDATE characters SET exhaustion_level = 3 WHERE id = $1`, [characterId]);
    const report = await getCharacterConditionEffects(pool, dmUserId, characterId);
    expect(report.exhaustionLevel).toBe(3);
    expect(report.exhaustionPenalty).toBe(-6);
    await pool.query(`UPDATE characters SET exhaustion_level = 0 WHERE id = $1`, [characterId]);
  });

  it('a monster instance reads its exhaustion level from an Exhaustion active_effects row (stack_count), not a dedicated column', async () => {
    await applyMonsterInstanceEffect(pool, dmUserId, monsterInstanceId, {
      effectDefinitionId: exhaustionEffectDefinitionId, sourceType: 'manual', stackCount: 2,
    });
    const report = await getMonsterInstanceConditionEffects(pool, dmUserId, monsterInstanceId);
    expect(report.exhaustionLevel).toBe(2);
    expect(report.exhaustionPenalty).toBe(-4);
  });

  it('Restrained gives Disadvantage on Dex saves only (not auto-fail), unconditional Advantage/Disadvantage on attacks', async () => {
    const restrainedRes = await pool.query<{ id: string }>(`SELECT id FROM effect_definitions WHERE name = 'Restrained' AND is_homebrew = false`);
    const freshRes = await pool.query<{ id: string }>(
      `INSERT INTO characters
         (campaign_id, is_pc, owner_user_id, created_by_user_id, name, str, dex, con, int, wis, cha,
          armor_class, speed, hp_max, hp_current)
       VALUES ($1, true, $2, $2, 'ConditionEffects Restrained PC', 10, 10, 10, 10, 10, 10, 12, 30, 10, 10)
       RETURNING id`,
      [campaignId, dmUserId],
    );
    await applyCharacterEffect(pool, dmUserId, freshRes.rows[0]!.id, { effectDefinitionId: restrainedRes.rows[0]!.id, sourceType: 'manual' });

    const report = await getCharacterConditionEffects(pool, dmUserId, freshRes.rows[0]!.id);
    expect(report.ownAttackRolls.disadvantageSources).toEqual(['restrained']);
    expect(report.attacksAgainstThemMelee.advantageSources).toEqual(['restrained']);
    expect(report.savingThrows.dex.disadvantageSources).toEqual(['restrained']);
    expect(report.savingThrows.dex.autoFail).toBe(false);
    expect(report.savingThrows.str.disadvantageSources).toEqual([]);
  });

  it('a non-condition active effect (e.g. Dodge) is excluded from the conditions list entirely', async () => {
    const dodgeRes = await pool.query<{ id: string }>(`SELECT id FROM effect_definitions WHERE name = 'Dodge' AND is_homebrew = false`);
    const freshRes = await pool.query<{ id: string }>(
      `INSERT INTO characters
         (campaign_id, is_pc, owner_user_id, created_by_user_id, name, str, dex, con, int, wis, cha,
          armor_class, speed, hp_max, hp_current)
       VALUES ($1, true, $2, $2, 'ConditionEffects Dodge PC', 10, 10, 10, 10, 10, 10, 12, 30, 10, 10)
       RETURNING id`,
      [campaignId, dmUserId],
    );
    await applyCharacterEffect(pool, dmUserId, freshRes.rows[0]!.id, { effectDefinitionId: dodgeRes.rows[0]!.id, sourceType: 'manual' });

    const report = await getCharacterConditionEffects(pool, dmUserId, freshRes.rows[0]!.id);
    expect(report.conditions).toEqual([]);
  });
});

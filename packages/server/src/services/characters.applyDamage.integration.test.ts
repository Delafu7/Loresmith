// Integration test for REFACTOR-PLAN.md §6's server-side damage application
// (services/characters.ts's applyDamage) — proves the real wiring (rolling
// dice server-side, reading damage_resistances/vulnerabilities/immunities
// off the actual row, applying computeAppliedDamage, feeding the result into
// the real HP-update statement), not just the pure computeAppliedDamage unit
// (damage.test.ts already covers that in isolation). Throwaway campaign/
// character fixtures, same isolation convention as
// monsters.uniqueness.integration.test.ts.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../db/pool.js';
import { applyDamage, undoLastDamage } from './characters.js';
import { applyCharacterEffect } from './effects.js';
import { AppError } from '../middleware/errors.js';

describe('applyDamage (integration, live DB, throwaway fixtures)', () => {
  let dmUserId: string;
  let campaignId: string;
  let resistantCharacterId: string;
  let plainCharacterId: string;

  beforeAll(async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const dmRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'ApplyDamage Test DM', 'x') RETURNING id`,
      [`apply-damage-dm-${suffix}@example.test`],
    );
    dmUserId = dmRes.rows[0]!.id;

    const campaignRes = await pool.query<{ id: string }>(
      `INSERT INTO campaigns (name, dm_user_id, srd_edition) VALUES ('ApplyDamage Test Campaign', $1, '2024') RETURNING id`,
      [dmUserId],
    );
    campaignId = campaignRes.rows[0]!.id;
    await pool.query(`INSERT INTO campaign_members (campaign_id, user_id, role) VALUES ($1, $2, 'dm')`, [campaignId, dmUserId]);

    const resistantRes = await pool.query<{ id: string }>(
      `INSERT INTO characters
         (campaign_id, is_pc, owner_user_id, created_by_user_id, name, str, dex, con, int, wis, cha,
          armor_class, speed, hp_max, hp_current, damage_resistances)
       VALUES ($1, true, $2, $2, 'Fire-Resistant PC', 10, 10, 10, 10, 10, 10, 12, 30, 50, 50, ARRAY['fire'])
       RETURNING id`,
      [campaignId, dmUserId],
    );
    resistantCharacterId = resistantRes.rows[0]!.id;

    const plainRes = await pool.query<{ id: string }>(
      `INSERT INTO characters
         (campaign_id, is_pc, owner_user_id, created_by_user_id, name, str, dex, con, int, wis, cha,
          armor_class, speed, hp_max, hp_current)
       VALUES ($1, true, $2, $2, 'Plain PC', 10, 10, 10, 10, 10, 10, 12, 30, 50, 50)
       RETURNING id`,
      [campaignId, dmUserId],
    );
    plainCharacterId = plainRes.rows[0]!.id;
  });

  afterAll(async () => {
    if (campaignId) await pool.query(`DELETE FROM campaigns WHERE id = $1`, [campaignId]);
    if (dmUserId) await pool.query(`DELETE FROM users WHERE id = $1`, [dmUserId]);
    await pool.end();
  });

  it('a client cannot bypass resistance — the server reads the real damage_resistances column, not a client-supplied final number', async () => {
    // The dice roll itself is non-deterministic (1d4, real server RNG) —
    // this test asserts the RELATIONSHIP (applied === floor(raw/2)) holds
    // for whatever the server actually rolled, not a specific fixed number.
    const result = await applyDamage(pool, dmUserId, resistantCharacterId, {
      diceSides: 4,
      diceCount: 1,
      modifier: 19,
      damageType: 'fire',
      isCritical: false,
    });
    expect(result.breakdown.resistanceApplied).toBe(true);
    expect(result.appliedDamage).toBeLessThan(result.rawTotal);
    expect(result.appliedDamage).toBe(Math.floor(result.rawTotal / 2));

    const row = await pool.query<{ hp_current: number }>(`SELECT hp_current FROM characters WHERE id = $1`, [resistantCharacterId]);
    expect(row.rows[0]!.hp_current).toBe(50 - result.appliedDamage);
  });

  it('the same raw damage against a non-resistant target applies in full', async () => {
    const result = await applyDamage(pool, dmUserId, plainCharacterId, {
      diceSides: 4,
      diceCount: 1,
      modifier: 19,
      damageType: 'fire',
      isCritical: false,
    });
    expect(result.breakdown.resistanceApplied).toBe(false);
    expect(result.appliedDamage).toBe(result.rawTotal);
  });

  // Security major M3 regression: isCritical used to be trusted directly
  // from the client — sending isCritical:true with no backing roll at all
  // used to double the dice unconditionally. The server now re-derives
  // criticality from the referenced attackRollId's actual stored roll.
  it('isCritical alone, with no attackRollId, no longer doubles the dice', async () => {
    const result = await applyDamage(pool, dmUserId, plainCharacterId, {
      diceSides: 4,
      diceCount: 1,
      modifier: 0,
      damageType: null,
      isCritical: true,
    } as Parameters<typeof applyDamage>[3]);
    expect(result.diceRoll.rolls.length).toBe(1); // still 1d4, not 2d4
  });

  it('an attackRollId pointing at a non-critical roll does not double the dice', async () => {
    const nonCritRoll = await pool.query<{ id: string }>(
      `INSERT INTO dice_rolls (campaign_id, user_id, roll_type, d20_rolls, keep, dice_sides, dice_count, modifier, result_total)
       VALUES ($1, $2, 'attack', ARRAY[15], 'normal', 20, 1, 0, 15) RETURNING id`,
      [campaignId, dmUserId],
    );
    const result = await applyDamage(pool, dmUserId, plainCharacterId, {
      diceSides: 4,
      diceCount: 1,
      modifier: 0,
      damageType: null,
      isCritical: true, // asserted by the client, but the referenced roll wasn't a nat 20
      attackRollId: nonCritRoll.rows[0]!.id,
    } as Parameters<typeof applyDamage>[3]);
    expect(result.diceRoll.rolls.length).toBe(1);
  });

  it('a critical hit doubles the dice count actually rolled, not just a post-hoc multiplier', async () => {
    // Simulates a real attack roll landing a nat 20 — the only way the
    // server will now treat a damage application as critical.
    const critRoll = await pool.query<{ id: string }>(
      `INSERT INTO dice_rolls (campaign_id, user_id, roll_type, d20_rolls, keep, dice_sides, dice_count, modifier, result_total)
       VALUES ($1, $2, 'attack', ARRAY[20], 'normal', 20, 1, 0, 20) RETURNING id`,
      [campaignId, dmUserId],
    );
    // diceCount=1 non-crit always totals within [1,4]; critical doubles to
    // 2d4, whose minimum possible total is 2 and maximum is 8 — assert the
    // roll landed in the range only reachable by 2 dice, proving the server
    // actually rolled double, not that it multiplied a 1-die result by 2
    // (which could coincidentally match some totals but not the full range
    // this assertion exercises across a few real rolls).
    const rolls: number[] = [];
    for (let i = 0; i < 20; i++) {
      const result = await applyDamage(pool, dmUserId, plainCharacterId, {
        diceSides: 4,
        diceCount: 1,
        modifier: 0,
        damageType: null,
        attackRollId: critRoll.rows[0]!.id,
      } as Parameters<typeof applyDamage>[3]);
      rolls.push(result.diceRoll.diceTotal);
      expect(result.diceRoll.rolls.length).toBe(2); // 2d4, not 1d4
    }
    // With 20 samples of 2d4, extremely likely at least one total exceeds 4
    // (the max a single d4 could ever produce) — proves real doubling, not
    // a fluke of always rolling low.
    expect(rolls.some((t) => t > 4)).toBe(true);
  });

  it('an advantage roll only counts as critical if the KEPT (higher) die is a nat 20', async () => {
    const advRoll = await pool.query<{ id: string }>(
      `INSERT INTO dice_rolls (campaign_id, user_id, roll_type, d20_rolls, keep, dice_sides, dice_count, modifier, result_total)
       VALUES ($1, $2, 'attack', ARRAY[20, 5], 'advantage', 20, 1, 0, 20) RETURNING id`,
      [campaignId, dmUserId],
    );
    const result = await applyDamage(pool, dmUserId, plainCharacterId, {
      diceSides: 4,
      diceCount: 1,
      modifier: 0,
      damageType: null,
      attackRollId: advRoll.rows[0]!.id,
    } as Parameters<typeof applyDamage>[3]);
    expect(result.diceRoll.rolls.length).toBe(2);
  });

  it('a disadvantage roll ignores a discarded nat 20 — the KEPT (lower) die decides criticality', async () => {
    const disadvRoll = await pool.query<{ id: string }>(
      `INSERT INTO dice_rolls (campaign_id, user_id, roll_type, d20_rolls, keep, dice_sides, dice_count, modifier, result_total)
       VALUES ($1, $2, 'attack', ARRAY[20, 5], 'disadvantage', 20, 1, 0, 5) RETURNING id`,
      [campaignId, dmUserId],
    );
    const result = await applyDamage(pool, dmUserId, plainCharacterId, {
      diceSides: 4,
      diceCount: 1,
      modifier: 0,
      damageType: null,
      attackRollId: disadvRoll.rows[0]!.id,
    } as Parameters<typeof applyDamage>[3]);
    expect(result.diceRoll.rolls.length).toBe(1); // discarded nat-20 must not count
  });

  // Regression test for the dice-engine rebuild's dice_rolls.is_critical
  // column (docs/rules/dice-mechanics.md §1.2/§1.4) — applyDamage's own
  // dice_rolls insert only fires when encounterId is supplied, so this is
  // the one test in this file that needs a throwaway encounter fixture.
  it('records is_critical on the dice_rolls row for both a critical and a non-critical damage roll', async () => {
    const encounterRes = await pool.query<{ id: string }>(
      `INSERT INTO encounters (campaign_id, name, status) VALUES ($1, 'is_critical Test Encounter', 'active') RETURNING id`,
      [campaignId],
    );
    const encounterId = encounterRes.rows[0]!.id;

    const critRoll = await pool.query<{ id: string }>(
      `INSERT INTO dice_rolls (campaign_id, user_id, roll_type, d20_rolls, keep, dice_sides, dice_count, modifier, result_total)
       VALUES ($1, $2, 'attack', ARRAY[20], 'normal', 20, 1, 0, 20) RETURNING id`,
      [campaignId, dmUserId],
    );
    await applyDamage(pool, dmUserId, plainCharacterId, {
      diceSides: 4,
      diceCount: 1,
      modifier: 0,
      damageType: null,
      attackRollId: critRoll.rows[0]!.id,
      encounterId,
    } as Parameters<typeof applyDamage>[3]);
    const critHistoryRow = await pool.query<{ is_critical: boolean }>(
      `SELECT is_critical FROM dice_rolls WHERE character_id = $1 AND roll_type = 'damage' ORDER BY created_at DESC LIMIT 1`,
      [plainCharacterId],
    );
    expect(critHistoryRow.rows[0]!.is_critical).toBe(true);

    await applyDamage(pool, dmUserId, plainCharacterId, {
      diceSides: 4,
      diceCount: 1,
      modifier: 0,
      damageType: null,
      encounterId,
    } as Parameters<typeof applyDamage>[3]);
    const nonCritHistoryRow = await pool.query<{ is_critical: boolean }>(
      `SELECT is_critical FROM dice_rolls WHERE character_id = $1 AND roll_type = 'damage' ORDER BY created_at DESC LIMIT 1`,
      [plainCharacterId],
    );
    expect(nonCritHistoryRow.rows[0]!.is_critical).toBe(false);
  });

  it('untyped damage (no damageType) is never resisted even against a resistant target', async () => {
    const result = await applyDamage(pool, dmUserId, resistantCharacterId, {
      diceSides: 4,
      diceCount: 1,
      modifier: 5,
      damageType: null,
      isCritical: false,
    });
    expect(result.appliedDamage).toBe(result.rawTotal);
  });

  describe('concentration-broken save prompt (Phase 2)', () => {
    it('reports a concentration check when the target is concentrating and takes damage, DC = max(10, floor(damage/2))', async () => {
      const defRes = await pool.query<{ id: string }>(
        `INSERT INTO effect_definitions
           (name, default_duration_type, default_duration_value, concentration, is_homebrew, owning_campaign_id)
         VALUES ('Hold Person', 'minutes', 10, true, true, $1)
         RETURNING id`,
        [campaignId],
      );
      const effectDefinitionId = defRes.rows[0]!.id;
      const { effect } = await applyCharacterEffect(pool, dmUserId, plainCharacterId, { effectDefinitionId, sourceType: 'manual' });

      const result = await applyDamage(pool, dmUserId, plainCharacterId, {
        diceSides: 4,
        diceCount: 1,
        modifier: 20, // guarantees appliedDamage > 0 regardless of the 1d4 roll
        damageType: null,
        isCritical: false,
      });

      expect(result.concentrationCheck).not.toBeNull();
      expect(result.concentrationCheck).toMatchObject({
        effectId: (effect as { id: string }).id,
        effectName: 'Hold Person',
        dc: Math.max(10, Math.floor(result.appliedDamage / 2)),
      });
    });

    it('is null when the target is not concentrating on anything', async () => {
      const result = await applyDamage(pool, dmUserId, resistantCharacterId, {
        diceSides: 4,
        diceCount: 1,
        modifier: 5,
        damageType: null,
        isCritical: false,
      });
      expect(result.concentrationCheck).toBeNull();
    });
  });

  describe('undoLastDamage (Phase 2)', () => {
    // A fresh, undamaged character per describe block — plainCharacterId has
    // already absorbed a lot of damage from the tests above (possibly down
    // to 0 hp, where further "damage" wouldn't visibly change hp_current at
    // all), which would make the undo assertions below flaky/meaningless.
    async function makeFreshCharacter(name: string): Promise<string> {
      const res = await pool.query<{ id: string }>(
        `INSERT INTO characters
           (campaign_id, is_pc, owner_user_id, created_by_user_id, name, str, dex, con, int, wis, cha, armor_class, speed, hp_max, hp_current)
         VALUES ($1, true, $2, $2, $3, 10, 10, 10, 10, 10, 10, 12, 30, 50, 50)
         RETURNING id`,
        [campaignId, dmUserId, name],
      );
      return res.rows[0]!.id;
    }

    it('restores exactly the pre-damage hp_current/hp_temp', async () => {
      const characterId = await makeFreshCharacter('Undo Test PC 1');
      const damaged = await applyDamage(pool, dmUserId, characterId, {
        diceSides: 4,
        diceCount: 1,
        modifier: 7,
        damageType: null,
        isCritical: false,
      });
      expect(damaged.character.hp_current).toBeLessThan(50);

      const undone = await undoLastDamage(pool, dmUserId, characterId);
      expect(undone.character.hp_current).toBe(50);
      expect(undone.character.hp_temp).toBe(0);
    });

    it('a second undo call with nothing left to undo throws CONFLICT', async () => {
      const characterId = await makeFreshCharacter('Undo Test PC 2');
      await applyDamage(pool, dmUserId, characterId, {
        diceSides: 4,
        diceCount: 1,
        modifier: 3,
        damageType: null,
        isCritical: false,
      });
      await undoLastDamage(pool, dmUserId, characterId);
      await expect(undoLastDamage(pool, dmUserId, characterId)).rejects.toMatchObject({ code: 'CONFLICT' });
    });

    it('rejects a non-DM caller even if they control the character', async () => {
      const playerRes = await pool.query<{ id: string }>(
        `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'Undo Test Player', 'x') RETURNING id`,
        [`undo-test-player-${Date.now()}@example.test`],
      );
      const playerUserId = playerRes.rows[0]!.id;
      try {
        await pool.query(`INSERT INTO campaign_members (campaign_id, user_id, role) VALUES ($1, $2, 'player')`, [campaignId, playerUserId]);
        const characterId = await makeFreshCharacter('Undo Test PC 3');
        await pool.query(`UPDATE characters SET owner_user_id = $1 WHERE id = $2`, [playerUserId, characterId]);
        await applyDamage(pool, dmUserId, characterId, {
          diceSides: 4,
          diceCount: 1,
          modifier: 3,
          damageType: null,
          isCritical: false,
        });
        await expect(undoLastDamage(pool, playerUserId, characterId)).rejects.toBeInstanceOf(AppError);
        await pool.query(`UPDATE characters SET owner_user_id = $1 WHERE id = $2`, [dmUserId, characterId]);
      } finally {
        await pool.query(`DELETE FROM campaign_members WHERE campaign_id = $1 AND user_id = $2`, [campaignId, playerUserId]);
        await pool.query(`DELETE FROM users WHERE id = $1`, [playerUserId]);
      }
    });
  });
});

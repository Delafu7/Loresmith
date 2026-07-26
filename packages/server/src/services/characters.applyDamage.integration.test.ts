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
import { applyDamage } from './characters.js';

describe('applyDamage (integration, live DB, throwaway fixtures)', () => {
  let dmUserId: number;
  let campaignId: number;
  let resistantCharacterId: number;
  let plainCharacterId: number;

  beforeAll(async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const dmRes = await pool.query<{ id: number }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'ApplyDamage Test DM', 'x') RETURNING id`,
      [`apply-damage-dm-${suffix}@example.test`],
    );
    dmUserId = dmRes.rows[0]!.id;

    const campaignRes = await pool.query<{ id: number }>(
      `INSERT INTO campaigns (name, dm_user_id, srd_edition) VALUES ('ApplyDamage Test Campaign', $1, '2024') RETURNING id`,
      [dmUserId],
    );
    campaignId = campaignRes.rows[0]!.id;
    await pool.query(`INSERT INTO campaign_members (campaign_id, user_id, role) VALUES ($1, $2, 'dm')`, [campaignId, dmUserId]);

    const resistantRes = await pool.query<{ id: number }>(
      `INSERT INTO characters
         (campaign_id, is_pc, owner_user_id, created_by_user_id, name, str, dex, con, int, wis, cha,
          armor_class, speed, hp_max, hp_current, damage_resistances)
       VALUES ($1, true, $2, $2, 'Fire-Resistant PC', 10, 10, 10, 10, 10, 10, 12, 30, 50, 50, ARRAY['fire'])
       RETURNING id`,
      [campaignId, dmUserId],
    );
    resistantCharacterId = resistantRes.rows[0]!.id;

    const plainRes = await pool.query<{ id: number }>(
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

  it('a critical hit doubles the dice count actually rolled, not just a post-hoc multiplier', async () => {
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
        isCritical: true,
      });
      rolls.push(result.diceRoll.diceTotal);
      expect(result.diceRoll.rolls.length).toBe(2); // 2d4, not 1d4
    }
    // With 20 samples of 2d4, extremely likely at least one total exceeds 4
    // (the max a single d4 could ever produce) — proves real doubling, not
    // a fluke of always rolling low.
    expect(rolls.some((t) => t > 4)).toBe(true);
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
});

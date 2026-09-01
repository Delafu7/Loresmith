// docs/roadmap/dnd-2024-gap-analysis.md P1-12 — half_on_save wiring, monster
// instance side. services/characters.applyDamage.integration.test.ts already
// covers the full behavior matrix (success/failure/negate/ordering/crit
// rejection/cross-campaign) against a character; this file only proves
// applyMonsterInstanceDamage (services/monsters.ts) is wired the same way,
// same "one parity test, not a duplicated matrix" precedent as
// damage.rageResistance.integration.test.ts's own monster-instance case.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../db/pool.js';
import { applyMonsterInstanceDamage } from './monsters.js';

describe('applyMonsterInstanceDamage half_on_save wiring (integration, live DB, throwaway fixtures)', () => {
  let dmUserId: string;
  let campaignId: string;
  let monsterInstanceId: string;

  beforeAll(async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const dmRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'HalfOnSave Test DM', 'x') RETURNING id`,
      [`half-on-save-dm-${suffix}@example.test`],
    );
    dmUserId = dmRes.rows[0]!.id;

    const campaignRes = await pool.query<{ id: string }>(
      `INSERT INTO campaigns (name, dm_user_id, srd_edition) VALUES ('HalfOnSave Test Campaign', $1, '2024') RETURNING id`,
      [dmUserId],
    );
    campaignId = campaignRes.rows[0]!.id;
    await pool.query(`INSERT INTO campaign_members (campaign_id, user_id, role) VALUES ($1, $2, 'dm')`, [campaignId, dmUserId]);

    const monsterCatalogRes = await pool.query<{ id: string }>(
      `INSERT INTO monsters
         (slug, name, edition_scope, size, creature_type, armor_class, hit_point_average, hit_dice, speed,
          str, dex, con, int, wis, cha, challenge_rating, xp_value, actions)
       VALUES ($1, 'HalfOnSave Test Beast', '2024', 'Medium', 'beast', 12, 50, '8d8+16', '{"walk":30}',
               16, 12, 14, 4, 10, 6, 1, 200, '[]'::jsonb)
       RETURNING id`,
      [`half-on-save-monster-${suffix}`],
    );
    const monsterCatalogId = monsterCatalogRes.rows[0]!.id;

    const instanceRes = await pool.query<{ id: string }>(
      `INSERT INTO monster_instances (campaign_id, monster_id, hp_current) VALUES ($1, $2, 50) RETURNING id`,
      [campaignId, monsterCatalogId],
    );
    monsterInstanceId = instanceRes.rows[0]!.id;
  });

  afterAll(async () => {
    if (campaignId) await pool.query(`DELETE FROM campaigns WHERE id = $1`, [campaignId]);
    if (dmUserId) await pool.query(`DELETE FROM users WHERE id = $1`, [dmUserId]);
    await pool.end();
  });

  async function insertSavingThrow(resultTotal: number): Promise<string> {
    const res = await pool.query<{ id: string }>(
      `INSERT INTO dice_rolls (campaign_id, user_id, roll_type, d20_rolls, keep, dice_sides, dice_count, modifier, result_total)
       VALUES ($1, $2, 'saving_throw', ARRAY[$3::int], 'normal', 20, 1, 0, $3) RETURNING id`,
      [campaignId, dmUserId, resultTotal],
    );
    return res.rows[0]!.id;
  }

  it('a successful save against the monster instance automatically halves damage', async () => {
    const saveRollId = await insertSavingThrow(18);
    const result = await applyMonsterInstanceDamage(pool, dmUserId, monsterInstanceId, {
      diceSides: 4,
      diceCount: 1,
      modifier: 19,
      damageType: null,
      isCritical: false,
      savingThrowRollId: saveRollId,
      saveDc: 14,
    });
    expect(result.appliedDamage).toBe(Math.floor(result.rawTotal / 2));
    expect(result.breakdown.savedHalved).toBe(true);
  });

  it('a failed save against the monster instance applies full damage', async () => {
    const saveRollId = await insertSavingThrow(2);
    const result = await applyMonsterInstanceDamage(pool, dmUserId, monsterInstanceId, {
      diceSides: 4,
      diceCount: 1,
      modifier: 19,
      damageType: null,
      isCritical: false,
      savingThrowRollId: saveRollId,
      saveDc: 14,
    });
    expect(result.appliedDamage).toBe(result.rawTotal);
    expect(result.breakdown.savedHalved).toBe(false);
  });

  it('halfOnSave: false negates damage entirely against the monster instance on a successful save', async () => {
    const saveRollId = await insertSavingThrow(18);
    const result = await applyMonsterInstanceDamage(pool, dmUserId, monsterInstanceId, {
      diceSides: 4,
      diceCount: 1,
      modifier: 19,
      damageType: null,
      isCritical: false,
      savingThrowRollId: saveRollId,
      saveDc: 14,
      halfOnSave: false,
    });
    expect(result.appliedDamage).toBe(0);
    expect(result.breakdown.savedNegated).toBe(true);
  });
});

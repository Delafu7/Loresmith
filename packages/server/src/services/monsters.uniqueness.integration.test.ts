// Integration test for REFACTOR-PLAN.md §2's uniqueness fix: an is_unique
// monster must have at most one LIVING instance, SYSTEM-WIDE — not the old
// behavior (scoped per-campaign, counting every status), which let the same
// named boss exist simultaneously in two campaigns while a merely-dead
// instance in one campaign still blocked a legitimate respawn there.
// Throwaway campaign/monster fixtures, same isolation convention as
// entityFieldReveal.integration.test.ts.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../db/pool.js';
import { createMonsterInstance, updateMonsterInstance } from './monsters.js';
import type { CreateMonsterInstanceInput } from '../schemas/monsters.js';

function instanceInput(overrides: Partial<CreateMonsterInstanceInput> = {}): CreateMonsterInstanceInput {
  return {
    monsterId: 0, // overwritten per-call
    customName: null,
    hpMaxOverride: null,
    armorClassOverride: null,
    hpCurrent: 10,
    hpTemp: 0,
    status: 'alive',
    isRecurring: false,
    notes: null,
    ...overrides,
  };
}

describe('unique monster instance enforcement (integration, live DB, throwaway fixtures)', () => {
  let dmUserId: number;
  let campaignAId: number;
  let campaignBId: number;
  let monsterId: number;

  beforeAll(async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const dmRes = await pool.query<{ id: number }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'Uniqueness Test DM', 'x') RETURNING id`,
      [`uniqueness-test-dm-${suffix}@example.test`],
    );
    dmUserId = dmRes.rows[0]!.id;

    const campaignARes = await pool.query<{ id: number }>(
      `INSERT INTO campaigns (name, dm_user_id, srd_edition) VALUES ('Uniqueness Test Campaign A', $1, '2024') RETURNING id`,
      [dmUserId],
    );
    campaignAId = campaignARes.rows[0]!.id;
    const campaignBRes = await pool.query<{ id: number }>(
      `INSERT INTO campaigns (name, dm_user_id, srd_edition) VALUES ('Uniqueness Test Campaign B', $1, '2024') RETURNING id`,
      [dmUserId],
    );
    campaignBId = campaignBRes.rows[0]!.id;

    const monsterRes = await pool.query<{ id: number }>(
      `INSERT INTO monsters
         (slug, name, edition_scope, size, creature_type, armor_class, hit_point_average, hit_dice,
          speed, str, dex, con, int, wis, cha, challenge_rating, xp_value, actions, is_unique)
       VALUES ($1, 'Uniqueness Test Boss', 'both', 'Medium', 'humanoid', 15, 30, '4d8+8',
               $2, 12, 12, 12, 12, 12, 12, 3, 700, $3, true)
       RETURNING id`,
      [`uniqueness-test-boss-${suffix}`, JSON.stringify({ walk: 30 }), JSON.stringify([{ name: 'Slam', description: 'melee attack' }])],
    );
    monsterId = monsterRes.rows[0]!.id;
  });

  afterAll(async () => {
    try {
      // Campaigns first — cascades away any leftover monster_instances rows
      // (monster_instances.monster_id itself has no ON DELETE clause, so
      // deleting the monster row first would hit that FK instead).
      if (campaignAId) await pool.query(`DELETE FROM campaigns WHERE id = $1`, [campaignAId]);
      if (campaignBId) await pool.query(`DELETE FROM campaigns WHERE id = $1`, [campaignBId]);
      if (monsterId) await pool.query(`DELETE FROM monsters WHERE id = $1`, [monsterId]);
    } finally {
      if (dmUserId) await pool.query(`DELETE FROM users WHERE id = $1`, [dmUserId]);
      await pool.end();
    }
  });

  // Every test below leaves zero LIVING instances of the fixture monster
  // behind (killing whatever it created before returning) — the uniqueness
  // check is system-wide and stateful across the whole `monsters` row, so
  // tests in this file are NOT independent of each other's leftover data
  // the way most integration tests are; explicit cleanup at the end of each
  // one keeps them from interfering.

  it('blocks spawning a second LIVING instance in a DIFFERENT campaign (the actual pre-fix bug)', async () => {
    const first = await createMonsterInstance(pool, campaignAId, instanceInput({ monsterId }));
    expect((first as { status: string }).status).toBe('alive');

    await expect(createMonsterInstance(pool, campaignBId, instanceInput({ monsterId }))).rejects.toMatchObject({
      code: 'CONFLICT',
    });

    await updateMonsterInstance(pool, campaignAId, (first as { id: number }).id, { status: 'dead' });
  });

  it('a dead instance no longer blocks a fresh spawn — old per-campaign/any-status check is gone', async () => {
    const first = await createMonsterInstance(pool, campaignAId, instanceInput({ monsterId }));
    await updateMonsterInstance(pool, campaignAId, (first as { id: number }).id, { status: 'dead' });

    // No living instance anywhere now, so this must succeed.
    const second = await createMonsterInstance(pool, campaignBId, instanceInput({ monsterId }));
    expect((second as { status: string }).status).toBe('alive');

    await updateMonsterInstance(pool, campaignBId, (second as { id: number }).id, { status: 'dead' });
  });

  it('reviving an instance back to alive is blocked if another instance is already living elsewhere', async () => {
    const first = await createMonsterInstance(pool, campaignAId, instanceInput({ monsterId }));
    await updateMonsterInstance(pool, campaignAId, (first as { id: number }).id, { status: 'dead' });

    const second = await createMonsterInstance(pool, campaignBId, instanceInput({ monsterId }));
    expect((second as { status: string }).status).toBe('alive');

    // Reviving the first instance would create a second living instance —
    // must be rejected the same way a fresh spawn would be.
    await expect(
      updateMonsterInstance(pool, campaignAId, (first as { id: number }).id, { status: 'alive' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    await updateMonsterInstance(pool, campaignBId, (second as { id: number }).id, { status: 'dead' });
  });
});

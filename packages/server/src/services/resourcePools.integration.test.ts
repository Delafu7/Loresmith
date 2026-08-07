// Regression test for the Iteration 3 minor sweep — spendResource/
// recoverResource used to return the raw character_resource_pools row
// directly; they now return { resource, campaignId } so the route layer
// can broadcast RESOURCE_POOL_CHANGED (same-player-two-tabs staleness fix,
// this pool previously broadcast nothing at all unlike every other
// combat-relevant mutation). This locks in the new wrapper shape and that
// campaignId actually matches the character's own campaign, not a
// hardcoded/wrong value. Throwaway campaign/character fixtures, same
// isolation convention as characters.gmNotesRedaction.integration.test.ts.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../db/pool.js';
import { spendResource, recoverResource } from './resourcePools.js';

describe('spendResource/recoverResource return shape (integration, live DB, throwaway fixtures)', () => {
  let dmUserId: string;
  let campaignId: string;
  let characterId: string;

  beforeAll(async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const dmRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'ResourcePool Test DM', 'x') RETURNING id`,
      [`resource-pool-dm-${suffix}@example.test`],
    );
    dmUserId = dmRes.rows[0]!.id;

    const campaignRes = await pool.query<{ id: string }>(
      `INSERT INTO campaigns (name, dm_user_id, srd_edition) VALUES ('ResourcePool Test Campaign', $1, '2024') RETURNING id`,
      [dmUserId],
    );
    campaignId = campaignRes.rows[0]!.id;
    await pool.query(`INSERT INTO campaign_members (campaign_id, user_id, role) VALUES ($1, $2, 'dm')`, [campaignId, dmUserId]);

    const characterRes = await pool.query<{ id: string }>(
      `INSERT INTO characters
         (campaign_id, is_pc, owner_user_id, created_by_user_id, name, str, dex, con, int, wis, cha, armor_class, speed, hp_max, hp_current)
       VALUES ($1, true, $2, $2, 'Resource Pool Test PC', 10, 10, 10, 10, 10, 10, 12, 30, 10, 10)
       RETURNING id`,
      [campaignId, dmUserId],
    );
    characterId = characterRes.rows[0]!.id;

    await pool.query(
      `INSERT INTO character_resource_pools (character_id, resource_key, current_value, max_value, recharge_on)
       VALUES ($1, 'ki_points', 3, 3, 'short_rest')`,
      [characterId],
    );
  });

  afterAll(async () => {
    if (campaignId) await pool.query(`DELETE FROM campaigns WHERE id = $1`, [campaignId]);
    if (dmUserId) await pool.query(`DELETE FROM users WHERE id = $1`, [dmUserId]);
    await pool.end();
  });

  it('spendResource returns { resource, campaignId } with the character\'s real campaign', async () => {
    const result = await spendResource(pool, dmUserId, characterId, 'ki_points', { amount: 1 });
    expect(result.campaignId).toBe(campaignId);
    expect(result.resource.current_value).toBe(2);
    expect(result.resource.resource_key).toBe('ki_points');
  });

  it('recoverResource returns { resource, campaignId } with the character\'s real campaign', async () => {
    const result = await recoverResource(pool, dmUserId, characterId, 'ki_points', { amount: 1 });
    expect(result.campaignId).toBe(campaignId);
    expect(result.resource.current_value).toBe(3);
  });
});

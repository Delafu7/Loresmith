// Integration test for the (now narrow) weakness-reveal engine's end-to-end
// read path: a player-role GET must never contain an unrevealed monster
// instance's damage vulnerabilities/resistances/immunities, even before any
// WebSocket involvement — this exercises the real wiring in
// services/monsters.ts (getMonsterInstance/listMonsterInstances), not just
// the pure redactEntityFields unit (entityFieldReveal.test.ts). Throwaway
// campaign/user/monster fixtures, same isolation convention as
// rests.performRest.integration.test.ts — never touches the seeded demo
// campaign.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../db/pool.js';
import { getMonsterInstance, listMonsterInstances } from './monsters.js';
import { updateMonsterInstanceReveals } from './entityFieldReveal.js';

describe('weakness reveal read-path redaction (integration, live DB, throwaway fixtures)', () => {
  let dmUserId: string;
  let playerUserId: string;
  let campaignId: string;
  let monsterId: string;
  let instanceId: string;

  beforeAll(async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const dmRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'Reveal Test DM', 'x') RETURNING id`,
      [`reveal-test-dm-${suffix}@example.test`],
    );
    dmUserId = dmRes.rows[0]!.id;

    const playerRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'Reveal Test Player', 'x') RETURNING id`,
      [`reveal-test-player-${suffix}@example.test`],
    );
    playerUserId = playerRes.rows[0]!.id;

    const campaignRes = await pool.query<{ id: string }>(
      `INSERT INTO campaigns (name, dm_user_id, srd_edition) VALUES ('Reveal Test Campaign', $1, '2024') RETURNING id`,
      [dmUserId],
    );
    campaignId = campaignRes.rows[0]!.id;

    await pool.query(`INSERT INTO campaign_members (campaign_id, user_id, role) VALUES ($1, $2, 'dm')`, [campaignId, dmUserId]);
    await pool.query(`INSERT INTO campaign_members (campaign_id, user_id, role) VALUES ($1, $2, 'player')`, [campaignId, playerUserId]);

    const monsterRes = await pool.query<{ id: string }>(
      `INSERT INTO monsters
         (slug, name, edition_scope, size, creature_type, armor_class, hit_point_average, hit_dice, speed,
          str, dex, con, int, wis, cha, damage_vulnerabilities, damage_resistances, damage_immunities,
          challenge_rating, xp_value, actions)
       VALUES ($1, 'Reveal Test Ooze', '2024', 'Medium', 'ooze', 8, 22, '4d8+4', '{"walk":10}',
               11, 8, 16, 1, 6, 1, ARRAY['radiant'], ARRAY['cold','fire'], ARRAY['poison'],
               2, 450, '[{"name":"Pseudopod","description":"Melee attack"}]'::jsonb)
       RETURNING id`,
      [`reveal-test-ooze-${suffix}`],
    );
    monsterId = monsterRes.rows[0]!.id;

    const instanceRes = await pool.query<{ id: string }>(
      `INSERT INTO monster_instances (campaign_id, monster_id, hp_current) VALUES ($1, $2, 22) RETURNING id`,
      [campaignId, monsterId],
    );
    instanceId = instanceRes.rows[0]!.id;
  });

  afterAll(async () => {
    try {
      if (campaignId) await pool.query(`DELETE FROM campaigns WHERE id = $1`, [campaignId]);
      if (monsterId) await pool.query(`DELETE FROM monsters WHERE id = $1`, [monsterId]);
    } finally {
      if (dmUserId) await pool.query(`DELETE FROM users WHERE id = $1`, [dmUserId]);
      if (playerUserId) await pool.query(`DELETE FROM users WHERE id = $1`, [playerUserId]);
      await pool.end();
    }
  });

  it('a fresh monster instance defaults to hidden weaknesses for a player, but true values for the DM', async () => {
    const dmView = (await getMonsterInstance(pool, campaignId, instanceId, 'dm')) as unknown as {
      damage_resistances: string[];
      damage_immunities: string[];
    };
    expect(dmView.damage_resistances).toEqual(['cold', 'fire']);
    expect(dmView.damage_immunities).toEqual(['poison']);

    const playerView = (await getMonsterInstance(pool, campaignId, instanceId, 'player')) as unknown as {
      damage_resistances: string[] | null;
      damage_immunities: string[] | null;
    };
    expect(playerView.damage_resistances).toBeNull();
    expect(playerView.damage_immunities).toBeNull();

    // Same redaction must hold on the list endpoint, not just GET by id.
    const playerList = (await listMonsterInstances(pool, campaignId, 'player')) as unknown as Array<{
      id: string;
      damage_resistances: string[] | null;
    }>;
    const row = playerList.find((mi) => mi.id === instanceId);
    expect(row?.damage_resistances).toBeNull();
  });

  it('revealing a field as DM makes the true value visible to a player, without touching other fields', async () => {
    await updateMonsterInstanceReveals(pool, dmUserId, instanceId, { fields: [{ fieldKey: 'damage_resistances', revealed: true }] });

    const playerView = (await getMonsterInstance(pool, campaignId, instanceId, 'player')) as unknown as {
      damage_resistances: string[] | null;
      damage_immunities: string[] | null;
    };
    expect(playerView.damage_resistances).toEqual(['cold', 'fire']);
    expect(playerView.damage_immunities).toBeNull(); // still hidden — revealing one field must not leak others
  });

  it('a playerOverride is served to the player instead of the true value, while the DM still sees the truth', async () => {
    await updateMonsterInstanceReveals(pool, dmUserId, instanceId, {
      fields: [{ fieldKey: 'damage_immunities', revealed: true, playerOverride: 'Seems immune to something...' }],
    });

    const playerView = (await getMonsterInstance(pool, campaignId, instanceId, 'player')) as unknown as { damage_immunities: unknown };
    expect(playerView.damage_immunities).toBe('Seems immune to something...');

    const dmView = (await getMonsterInstance(pool, campaignId, instanceId, 'dm')) as unknown as { damage_immunities: unknown };
    expect(dmView.damage_immunities).toEqual(['poison']);
  });

  it('a player cannot write reveal state (DM-only), even for a campaign they are a member of', async () => {
    await expect(
      updateMonsterInstanceReveals(pool, playerUserId, instanceId, { fields: [{ fieldKey: 'damage_resistances', revealed: true }] }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN_ROLE' });
  });
});

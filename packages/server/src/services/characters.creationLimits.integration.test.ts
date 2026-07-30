// Integration test for per-player character-creation permissions/limits
// (campaign_members.can_create_characters/max_characters, services/
// characters.ts's createCharacter player branch). Throwaway campaign/user
// fixtures, same isolation convention as characters.duplicate.integration.test.ts.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../db/pool.js';
import { createCharacter } from './characters.js';
import { listMembers } from './campaigns.js';

function baseInput(name: string) {
  return {
    name,
    isPc: true,
    str: 10,
    dex: 10,
    con: 10,
    int: 10,
    wis: 10,
    cha: 10,
    armorClass: 12,
    speed: 30,
    hpMax: 10,
    hpTemp: 0,
    exhaustionLevel: 0,
    damageResistances: [],
    damageVulnerabilities: [],
    damageImmunities: [],
  } as never;
}

describe('per-player character-creation limits (integration, live DB, throwaway fixtures)', () => {
  let dmUserId: string;
  let blockedPlayerUserId: string;
  let limitedPlayerUserId: string;
  let campaignId: string;
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  beforeAll(async () => {
    const dmRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'CreationLimits Test DM', 'x') RETURNING id`,
      [`creation-limits-dm-${suffix}@example.test`],
    );
    dmUserId = dmRes.rows[0]!.id;

    const blockedRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'CreationLimits Blocked Player', 'x') RETURNING id`,
      [`creation-limits-blocked-${suffix}@example.test`],
    );
    blockedPlayerUserId = blockedRes.rows[0]!.id;

    const limitedRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'CreationLimits Limited Player', 'x') RETURNING id`,
      [`creation-limits-limited-${suffix}@example.test`],
    );
    limitedPlayerUserId = limitedRes.rows[0]!.id;

    const campaignRes = await pool.query<{ id: string }>(
      `INSERT INTO campaigns (name, dm_user_id, srd_edition) VALUES ('CreationLimits Test Campaign', $1, '2024') RETURNING id`,
      [dmUserId],
    );
    campaignId = campaignRes.rows[0]!.id;

    await pool.query(
      `INSERT INTO campaign_members (campaign_id, user_id, role, can_create_characters) VALUES ($1, $2, 'player', false)`,
      [campaignId, blockedPlayerUserId],
    );
    await pool.query(
      `INSERT INTO campaign_members (campaign_id, user_id, role, max_characters) VALUES ($1, $2, 'player', 1)`,
      [campaignId, limitedPlayerUserId],
    );
  });

  afterAll(async () => {
    if (campaignId) await pool.query(`DELETE FROM campaigns WHERE id = $1`, [campaignId]);
    if (dmUserId) await pool.query(`DELETE FROM users WHERE id = $1`, [dmUserId]);
    if (blockedPlayerUserId) await pool.query(`DELETE FROM users WHERE id = $1`, [blockedPlayerUserId]);
    if (limitedPlayerUserId) await pool.query(`DELETE FROM users WHERE id = $1`, [limitedPlayerUserId]);
    await pool.end();
  });

  // Regression guard: listMembers' SQL used to hand-list its SELECT columns
  // and silently omitted these two on first pass, which meant the DM
  // members-page UI always rendered "disabled"/"0" regardless of the real
  // DB values — this is what caught it, via live browser verification.
  it('listMembers surfaces can_create_characters and max_characters', async () => {
    const members = await listMembers(pool, campaignId);
    const blocked = members.find((m) => m.user_id === blockedPlayerUserId);
    const limited = members.find((m) => m.user_id === limitedPlayerUserId);
    expect(blocked?.can_create_characters).toBe(false);
    expect(limited?.max_characters).toBe(1);
  });

  it('rejects character creation for a player with can_create_characters=false', async () => {
    await expect(
      createCharacter(pool, blockedPlayerUserId, campaignId, 'player', baseInput('Blocked PC Attempt')),
    ).rejects.toMatchObject({ code: 'FORBIDDEN_ROLE' });
  });

  it('allows the first character up to max_characters, then rejects the next', async () => {
    const first = await createCharacter(pool, limitedPlayerUserId, campaignId, 'player', baseInput('Limited PC One'));
    expect(first.owner_user_id).toBe(limitedPlayerUserId);

    await expect(
      createCharacter(pool, limitedPlayerUserId, campaignId, 'player', baseInput('Limited PC Two')),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('concurrent creates at the max_characters boundary: exactly one succeeds', async () => {
    // A fresh player at the same campaign, max_characters = 1, starting from
    // zero characters — fire two creates at once to exercise the FOR UPDATE
    // serialization rather than the sequential case above.
    const raceRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'CreationLimits Race Player', 'x') RETURNING id`,
      [`creation-limits-race-${suffix}@example.test`],
    );
    const racePlayerId = raceRes.rows[0]!.id;
    await pool.query(
      `INSERT INTO campaign_members (campaign_id, user_id, role, max_characters) VALUES ($1, $2, 'player', 1)`,
      [campaignId, racePlayerId],
    );

    try {
      const results = await Promise.allSettled([
        createCharacter(pool, racePlayerId, campaignId, 'player', baseInput('Race PC A')),
        createCharacter(pool, racePlayerId, campaignId, 'player', baseInput('Race PC B')),
      ]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({ code: 'CONFLICT' });

      const countRes = await pool.query<{ count: string }>(
        `SELECT COUNT(*)::int AS count FROM characters WHERE campaign_id = $1 AND owner_user_id = $2`,
        [campaignId, racePlayerId],
      );
      expect(Number(countRes.rows[0]!.count)).toBe(1);
    } finally {
      await pool.query(`DELETE FROM characters WHERE campaign_id = $1 AND owner_user_id = $2`, [campaignId, racePlayerId]);
      await pool.query(`DELETE FROM campaign_members WHERE campaign_id = $1 AND user_id = $2`, [campaignId, racePlayerId]);
      await pool.query(`DELETE FROM users WHERE id = $1`, [racePlayerId]);
    }
  });
});

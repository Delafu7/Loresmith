// Integration test for the spectator-role bug fix in
// services/characters.ts's createCharacter (Iteration 2 "Character
// ownership vs. control"): before this fix, any CampaignRole other than
// 'player' silently fell through to the DM code path, so a future
// 'spectator' role would have been able to create arbitrary characters.
// Confirms it's now explicitly rejected instead.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../db/pool.js';
import { createCharacter } from './characters.js';

describe('createCharacter rejects the spectator role (integration, live DB, throwaway fixtures)', () => {
  let dmUserId: string;
  let spectatorUserId: string;
  let campaignId: string;

  beforeAll(async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const dmRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'Spectator Test DM', 'x') RETURNING id`,
      [`spectator-dm-${suffix}@example.test`],
    );
    dmUserId = dmRes.rows[0]!.id;

    const spectatorRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'Spectator Test Spectator', 'x') RETURNING id`,
      [`spectator-spec-${suffix}@example.test`],
    );
    spectatorUserId = spectatorRes.rows[0]!.id;

    const campaignRes = await pool.query<{ id: string }>(
      `INSERT INTO campaigns (name, dm_user_id, srd_edition) VALUES ('Spectator Test Campaign', $1, '2024') RETURNING id`,
      [dmUserId],
    );
    campaignId = campaignRes.rows[0]!.id;
    await pool.query(
      `INSERT INTO campaign_members (campaign_id, user_id, role) VALUES ($1, $2, 'dm'), ($1, $3, 'spectator')`,
      [campaignId, dmUserId, spectatorUserId],
    );
  });

  afterAll(async () => {
    if (campaignId) await pool.query(`DELETE FROM campaigns WHERE id = $1`, [campaignId]);
    await pool.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [[dmUserId, spectatorUserId]]);
    await pool.end();
  });

  const baseInput = {
    name: 'Spectator Attempt',
    isPc: true,
    str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10,
    armorClass: 10, speed: 30, hpMax: 10, hpTemp: 0, exhaustionLevel: 0,
    damageResistances: [], damageVulnerabilities: [], damageImmunities: [],
  };

  it('rejects a spectator creating a character (would otherwise fall through to the DM code path)', async () => {
    await expect(createCharacter(pool, spectatorUserId, campaignId, 'spectator', baseInput)).rejects.toMatchObject({
      code: 'FORBIDDEN_ROLE',
    });

    const rows = await pool.query(`SELECT id FROM characters WHERE campaign_id = $1`, [campaignId]);
    expect(rows.rows).toHaveLength(0);
  });

  it('the DM role is unaffected by the fix and can still create characters', async () => {
    const character = await createCharacter(pool, dmUserId, campaignId, 'dm', baseInput);
    expect(character.name).toBe('Spectator Attempt');
  });
});

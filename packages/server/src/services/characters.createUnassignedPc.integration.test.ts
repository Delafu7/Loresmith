// Integration test for createCharacter (services/characters.ts) now that a
// DM can create a PC with no owning player at all — characters_check no
// longer forces every PC to have a non-null owner
// (1784269776666_relax-characters-owner-check.ts). Also covers that a
// player's own self-create path is unaffected. Throwaway campaign fixtures,
// same isolation convention as characters.duplicate.integration.test.ts.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../db/pool.js';
import { createCharacter } from './characters.js';

function baseInput(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    name: 'Unassigned Test PC',
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
    ...overrides,
  } as never;
}

describe('createCharacter unassigned-PC support (integration, live DB, throwaway fixtures)', () => {
  let dmUserId: string;
  let playerUserId: string;
  let campaignId: string;

  beforeAll(async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const dmRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'CreateUnassigned Test DM', 'x') RETURNING id`,
      [`create-unassigned-dm-${suffix}@example.test`],
    );
    dmUserId = dmRes.rows[0]!.id;

    const playerRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'CreateUnassigned Test Player', 'x') RETURNING id`,
      [`create-unassigned-player-${suffix}@example.test`],
    );
    playerUserId = playerRes.rows[0]!.id;

    const campaignRes = await pool.query<{ id: string }>(
      `INSERT INTO campaigns (name, dm_user_id, srd_edition) VALUES ('CreateUnassigned Test Campaign', $1, '2024') RETURNING id`,
      [dmUserId],
    );
    campaignId = campaignRes.rows[0]!.id;
    await pool.query(`INSERT INTO campaign_members (campaign_id, user_id, role) VALUES ($1, $2, 'dm')`, [campaignId, dmUserId]);
    await pool.query(`INSERT INTO campaign_members (campaign_id, user_id, role) VALUES ($1, $2, 'player')`, [campaignId, playerUserId]);
  });

  afterAll(async () => {
    if (campaignId) await pool.query(`DELETE FROM campaigns WHERE id = $1`, [campaignId]);
    if (dmUserId) await pool.query(`DELETE FROM users WHERE id = $1`, [dmUserId]);
    if (playerUserId) await pool.query(`DELETE FROM users WHERE id = $1`, [playerUserId]);
    await pool.end();
  });

  it('lets a DM create a PC with no owning player at all', async () => {
    const character = await createCharacter(pool, dmUserId, campaignId, 'dm', baseInput({ isPc: true, ownerUserId: null }));
    expect(character.is_pc).toBe(true);
    expect(character.owner_user_id).toBeNull();
  });

  it('a DM-created NPC still has no owner (unchanged behavior)', async () => {
    const character = await createCharacter(
      pool,
      dmUserId,
      campaignId,
      'dm',
      baseInput({ name: 'DM NPC', isPc: false, ownerUserId: null }),
    );
    expect(character.is_pc).toBe(false);
    expect(character.owner_user_id).toBeNull();
  });

  it('a DM-created NPC has its owner forced to null even if one is (incorrectly) supplied', async () => {
    const character = await createCharacter(
      pool,
      dmUserId,
      campaignId,
      'dm',
      baseInput({ name: 'DM NPC With Stray Owner', isPc: false, ownerUserId: playerUserId }),
    );
    expect(character.owner_user_id).toBeNull();
  });

  it('a player creating their own PC is still self-assigned, unaffected by the relaxed DM path', async () => {
    const character = await createCharacter(
      pool,
      playerUserId,
      campaignId,
      'player',
      baseInput({ name: 'Player Self PC' }),
    );
    expect(character.is_pc).toBe(true);
    expect(character.owner_user_id).toBe(playerUserId);
  });
});

// Integration test for the Phase 1 "full CRUD incl. duplicate" requirement
// on characters — proves duplicateCharacter (services/characters.ts) copies
// every column off a real row rather than a hand-maintained field list, and
// enforces the same owner-or-DM authorization as update/delete. Throwaway
// campaign/character fixtures, same isolation convention as
// characters.applyDamage.integration.test.ts.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../db/pool.js';
import { duplicateCharacter } from './characters.js';
import { AppError } from '../middleware/errors.js';

describe('duplicateCharacter (integration, live DB, throwaway fixtures)', () => {
  let dmUserId: string;
  let playerUserId: string;
  let otherPlayerUserId: string;
  let campaignId: string;
  let pcId: string;
  let npcId: string;

  beforeAll(async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const dmRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'Duplicate Test DM', 'x') RETURNING id`,
      [`duplicate-char-dm-${suffix}@example.test`],
    );
    dmUserId = dmRes.rows[0]!.id;

    const playerRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'Duplicate Test Player', 'x') RETURNING id`,
      [`duplicate-char-player-${suffix}@example.test`],
    );
    playerUserId = playerRes.rows[0]!.id;

    const otherRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'Duplicate Test Other Player', 'x') RETURNING id`,
      [`duplicate-char-other-${suffix}@example.test`],
    );
    otherPlayerUserId = otherRes.rows[0]!.id;

    const campaignRes = await pool.query<{ id: string }>(
      `INSERT INTO campaigns (name, dm_user_id, srd_edition) VALUES ('Duplicate Test Campaign', $1, '2024') RETURNING id`,
      [dmUserId],
    );
    campaignId = campaignRes.rows[0]!.id;
    await pool.query(`INSERT INTO campaign_members (campaign_id, user_id, role) VALUES ($1, $2, 'dm')`, [campaignId, dmUserId]);
    await pool.query(`INSERT INTO campaign_members (campaign_id, user_id, role) VALUES ($1, $2, 'player')`, [campaignId, playerUserId]);
    await pool.query(`INSERT INTO campaign_members (campaign_id, user_id, role) VALUES ($1, $2, 'player')`, [campaignId, otherPlayerUserId]);

    const pcRes = await pool.query<{ id: string }>(
      `INSERT INTO characters
         (campaign_id, is_pc, owner_user_id, created_by_user_id, name, str, dex, con, int, wis, cha,
          armor_class, speed, hp_max, hp_current, hp_temp, damage_resistances, is_alive)
       VALUES ($1, true, $2, $2, 'Original PC', 10, 11, 12, 13, 14, 15, 16, 30, 40, 22, 3, ARRAY['fire'], false)
       RETURNING id`,
      [campaignId, playerUserId],
    );
    pcId = pcRes.rows[0]!.id;

    const npcRes = await pool.query<{ id: string }>(
      `INSERT INTO characters
         (campaign_id, is_pc, owner_user_id, created_by_user_id, name, str, dex, con, int, wis, cha,
          armor_class, speed, hp_max, hp_current)
       VALUES ($1, false, NULL, $2, 'Original NPC', 8, 8, 8, 8, 8, 8, 10, 30, 5, 5)
       RETURNING id`,
      [campaignId, dmUserId],
    );
    npcId = npcRes.rows[0]!.id;
  });

  afterAll(async () => {
    if (campaignId) await pool.query(`DELETE FROM campaigns WHERE id = $1`, [campaignId]);
    for (const id of [dmUserId, playerUserId, otherPlayerUserId]) {
      if (id) await pool.query(`DELETE FROM users WHERE id = $1`, [id]);
    }
    await pool.end();
  });

  it('copies every stat column, resets HP to full and alive, and suffixes the name', async () => {
    const copy = await duplicateCharacter(pool, dmUserId, pcId);
    expect(copy.name).toBe('Original PC (Copy)');
    expect(copy.id).not.toBe(pcId);
    expect(copy.hp_max).toBe(40);
    expect(copy.hp_current).toBe(40); // reset to full, not the source's damaged 22
    expect(copy.hp_temp).toBe(0);
    expect(copy.is_alive).toBe(true); // reset, not the source's false
    expect(copy.damage_resistances).toEqual(['fire']);
    expect(copy.owner_user_id).toBe(playerUserId);
    expect(copy.campaign_id).toBe(campaignId);

    await pool.query(`DELETE FROM characters WHERE id = $1`, [copy.id]);
  });

  it('the owning player can duplicate their own PC', async () => {
    const copy = await duplicateCharacter(pool, playerUserId, pcId);
    expect(copy.owner_user_id).toBe(playerUserId);
    await pool.query(`DELETE FROM characters WHERE id = $1`, [copy.id]);
  });

  it('a different player cannot duplicate someone else\'s PC', async () => {
    await expect(duplicateCharacter(pool, otherPlayerUserId, pcId)).rejects.toThrow(AppError);
  });

  it('the DM can duplicate an NPC', async () => {
    const copy = await duplicateCharacter(pool, dmUserId, npcId);
    expect(copy.name).toBe('Original NPC (Copy)');
    expect(copy.is_pc).toBe(false);
    expect(copy.owner_user_id).toBeNull();
    await pool.query(`DELETE FROM characters WHERE id = $1`, [copy.id]);
  });

  it('a player cannot duplicate an NPC', async () => {
    await expect(duplicateCharacter(pool, playerUserId, npcId)).rejects.toThrow(AppError);
  });
});

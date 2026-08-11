// Integration test for character_currency (Phase 1.5 of the backlog
// implementation plan) — the app had zero coin tracking before this.
// Covers: default zero-purse before any write, partial-update-preserves-
// other-denominations (the ON CONFLICT DO UPDATE / COALESCE upsert in
// services/characterCurrency.ts is the one subtle bit — a first-time insert
// must default missing fields to 0, a later update must default them to the
// PREVIOUS value, from the same null-means-unset parameter list), and that
// a non-owner player is rejected. Throwaway campaign/character fixtures,
// same isolation convention as resourcePools.integration.test.ts.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../db/pool.js';
import { getCharacterCurrency, updateCharacterCurrency } from './characterCurrency.js';
import { AppError } from '../middleware/errors.js';

describe('character currency (integration, live DB, throwaway fixtures)', () => {
  let dmUserId: string;
  let ownerUserId: string;
  let otherPlayerUserId: string;
  let campaignId: string;
  let characterId: string;

  beforeAll(async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const dmRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'Currency Test DM', 'x') RETURNING id`,
      [`currency-dm-${suffix}@example.test`],
    );
    dmUserId = dmRes.rows[0]!.id;

    const ownerRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'Currency Test Owner', 'x') RETURNING id`,
      [`currency-owner-${suffix}@example.test`],
    );
    ownerUserId = ownerRes.rows[0]!.id;

    const otherRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'Currency Test Other Player', 'x') RETURNING id`,
      [`currency-other-${suffix}@example.test`],
    );
    otherPlayerUserId = otherRes.rows[0]!.id;

    const campaignRes = await pool.query<{ id: string }>(
      `INSERT INTO campaigns (name, dm_user_id, srd_edition) VALUES ('Currency Test Campaign', $1, '2024') RETURNING id`,
      [dmUserId],
    );
    campaignId = campaignRes.rows[0]!.id;
    await pool.query(`INSERT INTO campaign_members (campaign_id, user_id, role) VALUES ($1, $2, 'dm')`, [campaignId, dmUserId]);
    await pool.query(`INSERT INTO campaign_members (campaign_id, user_id, role) VALUES ($1, $2, 'player')`, [campaignId, ownerUserId]);
    await pool.query(`INSERT INTO campaign_members (campaign_id, user_id, role) VALUES ($1, $2, 'player')`, [campaignId, otherPlayerUserId]);

    const characterRes = await pool.query<{ id: string }>(
      `INSERT INTO characters
         (campaign_id, is_pc, owner_user_id, created_by_user_id, name, str, dex, con, int, wis, cha, armor_class, speed, hp_max, hp_current)
       VALUES ($1, true, $2, $2, 'Currency Test PC', 10, 10, 10, 10, 10, 10, 12, 30, 10, 10)
       RETURNING id`,
      [campaignId, ownerUserId],
    );
    characterId = characterRes.rows[0]!.id;
  });

  afterAll(async () => {
    if (campaignId) await pool.query(`DELETE FROM campaigns WHERE id = $1`, [campaignId]);
    for (const id of [dmUserId, ownerUserId, otherPlayerUserId]) {
      if (id) await pool.query(`DELETE FROM users WHERE id = $1`, [id]);
    }
    await pool.end();
  });

  it('defaults to an all-zero purse before any write', async () => {
    const currency = await getCharacterCurrency(pool, dmUserId, characterId);
    expect(currency).toMatchObject({ cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 });
  });

  it('a partial update sets the given denominations and leaves the rest untouched', async () => {
    const first = await updateCharacterCurrency(pool, ownerUserId, characterId, { gp: 15, cp: 3 });
    expect(first).toMatchObject({ gp: 15, cp: 3, sp: 0, ep: 0, pp: 0 });

    const second = await updateCharacterCurrency(pool, ownerUserId, characterId, { sp: 8 });
    expect(second).toMatchObject({ gp: 15, cp: 3, sp: 8, ep: 0, pp: 0 });
  });

  it('rejects a write from a campaign member who neither owns nor DMs this character', async () => {
    await expect(updateCharacterCurrency(pool, otherPlayerUserId, characterId, { gp: 100 })).rejects.toThrow(AppError);
  });

  it('the DM may write currency for any character', async () => {
    const result = await updateCharacterCurrency(pool, dmUserId, characterId, { pp: 2 });
    expect(result.pp).toBe(2);
  });
});

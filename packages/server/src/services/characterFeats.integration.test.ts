// Integration test for character_feats (compendium feature, Phase 5):
// persists feat selection made during character creation. Throwaway
// campaign/user/character fixtures, same isolation convention as
// characterItems.integration.test.ts; reads (never mutates) a handful of
// existing seeded catalog `feats` rows as read-only FK targets.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../db/pool.js';
import { grantCharacterFeat, listCharacterFeats, revokeCharacterFeat } from './characterFeats.js';

describe('character_feats (integration, live DB, throwaway fixtures)', () => {
  let dmUserId: string;
  let playerUserId: string;
  let campaignId: string;
  let characterId: string;
  let featIds: string[];

  beforeAll(async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const dmRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'Feats Test DM', 'x') RETURNING id`,
      [`character-feats-dm-${suffix}@example.test`],
    );
    dmUserId = dmRes.rows[0]!.id;

    const playerRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'Feats Test Player', 'x') RETURNING id`,
      [`character-feats-player-${suffix}@example.test`],
    );
    playerUserId = playerRes.rows[0]!.id;

    const campaignRes = await pool.query<{ id: string }>(
      `INSERT INTO campaigns (name, dm_user_id, srd_edition) VALUES ('Feats Test Campaign', $1, '2024') RETURNING id`,
      [dmUserId],
    );
    campaignId = campaignRes.rows[0]!.id;
    await pool.query(`INSERT INTO campaign_members (campaign_id, user_id, role) VALUES ($1, $2, 'dm')`, [campaignId, dmUserId]);
    await pool.query(`INSERT INTO campaign_members (campaign_id, user_id, role) VALUES ($1, $2, 'player')`, [campaignId, playerUserId]);

    const characterRes = await pool.query<{ id: string }>(
      `INSERT INTO characters
         (campaign_id, is_pc, owner_user_id, created_by_user_id, name, str, dex, con, int, wis, cha, armor_class, speed, hp_max, hp_current)
       VALUES ($1, true, $2, $2, 'Feats Test PC', 10, 10, 10, 10, 10, 10, 12, 30, 10, 10)
       RETURNING id`,
      [campaignId, playerUserId],
    );
    characterId = characterRes.rows[0]!.id;

    const featsRes = await pool.query<{ id: string }>(`SELECT id FROM feats ORDER BY id LIMIT 2`);
    if (featsRes.rows.length < 2) throw new Error('Expected at least 2 seeded catalog feats');
    featIds = featsRes.rows.map((r) => r.id);
  });

  afterAll(async () => {
    try {
      if (campaignId) await pool.query(`DELETE FROM campaigns WHERE id = $1`, [campaignId]);
    } finally {
      if (dmUserId) await pool.query(`DELETE FROM users WHERE id = $1`, [dmUserId]);
      if (playerUserId) await pool.query(`DELETE FROM users WHERE id = $1`, [playerUserId]);
      await pool.end();
    }
  });

  it('the owning player can grant, list, and revoke feats on their own character', async () => {
    const feat1 = await grantCharacterFeat(pool, playerUserId, characterId, { featId: featIds[0]! });
    expect(feat1.character_id).toBe(characterId);
    expect(feat1.feat_id).toBe(featIds[0]);

    await grantCharacterFeat(pool, playerUserId, characterId, { featId: featIds[1]! });

    const list = await listCharacterFeats(pool, playerUserId, characterId);
    expect(list.map((f: any) => f.feat_id).sort()).toEqual([...featIds].sort());

    await revokeCharacterFeat(pool, playerUserId, characterId, featIds[0]!);
    const afterRevoke = await listCharacterFeats(pool, playerUserId, characterId);
    expect(afterRevoke.map((f: any) => f.feat_id)).toEqual([featIds[1]]);

    await revokeCharacterFeat(pool, playerUserId, characterId, featIds[1]!);
  });

  it('granting the same feat twice is a clean CONFLICT, not a raw constraint error', async () => {
    await grantCharacterFeat(pool, playerUserId, characterId, { featId: featIds[0]! });
    await expect(
      grantCharacterFeat(pool, playerUserId, characterId, { featId: featIds[0]! }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    await revokeCharacterFeat(pool, playerUserId, characterId, featIds[0]!);
  });

  it('revoking a feat the character does not have 404s', async () => {
    await expect(revokeCharacterFeat(pool, playerUserId, characterId, featIds[0]!)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('another campaign member (not the owner or DM) cannot grant a feat', async () => {
    const otherPlayerRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'Feats Test Other Player', 'x') RETURNING id`,
      [`character-feats-other-${Date.now()}@example.test`],
    );
    const otherPlayerId = otherPlayerRes.rows[0]!.id;
    await pool.query(`INSERT INTO campaign_members (campaign_id, user_id, role) VALUES ($1, $2, 'player')`, [campaignId, otherPlayerId]);

    await expect(
      grantCharacterFeat(pool, otherPlayerId, characterId, { featId: featIds[0]! }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN_NOT_OWNER' });

    await pool.query(`DELETE FROM campaign_members WHERE user_id = $1`, [otherPlayerId]);
    await pool.query(`DELETE FROM users WHERE id = $1`, [otherPlayerId]);
  });

  it('the DM can grant and revoke feats on a character they do not own', async () => {
    const feat = await grantCharacterFeat(pool, dmUserId, characterId, { featId: featIds[0]! });
    expect(feat.feat_id).toBe(featIds[0]);
    await revokeCharacterFeat(pool, dmUserId, characterId, featIds[0]!);
  });
});

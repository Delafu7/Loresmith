// Integration test for the Phase 1 "full CRUD" requirement on campaign
// assets — proves updateAssetTitle (services/assets.ts) enforces the same
// owner-or-DM authorization as deleteAsset, and that updated_at actually
// moves while created_at stays put. Throwaway campaign/user/asset fixtures,
// same isolation convention as characters.duplicate.integration.test.ts.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../db/pool.js';
import { updateAssetTitle } from './assets.js';
import { AppError } from '../middleware/errors.js';

describe('updateAssetTitle (integration, live DB, throwaway fixtures)', () => {
  let dmUserId: string;
  let playerUserId: string;
  let otherPlayerUserId: string;
  let campaignId: string;
  let assetId: string;

  beforeAll(async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const dmRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'Update Asset Test DM', 'x') RETURNING id`,
      [`update-asset-dm-${suffix}@example.test`],
    );
    dmUserId = dmRes.rows[0]!.id;

    const playerRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'Update Asset Test Player', 'x') RETURNING id`,
      [`update-asset-player-${suffix}@example.test`],
    );
    playerUserId = playerRes.rows[0]!.id;

    const otherRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'Update Asset Test Other Player', 'x') RETURNING id`,
      [`update-asset-other-${suffix}@example.test`],
    );
    otherPlayerUserId = otherRes.rows[0]!.id;

    const campaignRes = await pool.query<{ id: string }>(
      `INSERT INTO campaigns (name, dm_user_id, srd_edition) VALUES ('Update Asset Test Campaign', $1, '2024') RETURNING id`,
      [dmUserId],
    );
    campaignId = campaignRes.rows[0]!.id;
    await pool.query(`INSERT INTO campaign_members (campaign_id, user_id, role) VALUES ($1, $2, 'dm')`, [campaignId, dmUserId]);
    await pool.query(`INSERT INTO campaign_members (campaign_id, user_id, role) VALUES ($1, $2, 'player')`, [campaignId, playerUserId]);
    await pool.query(`INSERT INTO campaign_members (campaign_id, user_id, role) VALUES ($1, $2, 'player')`, [campaignId, otherPlayerUserId]);

    const assetRes = await pool.query<{ id: string }>(
      `INSERT INTO campaign_assets (campaign_id, uploaded_by_user_id, asset_type, file_url, mime_type, file_size_bytes, title)
       VALUES ($1, $2, 'image', '/uploads/campaigns/test/asset.png', 'image/png', 1024, 'Original Title')
       RETURNING id`,
      [campaignId, playerUserId],
    );
    assetId = assetRes.rows[0]!.id;
  });

  afterAll(async () => {
    if (campaignId) await pool.query(`DELETE FROM campaigns WHERE id = $1`, [campaignId]);
    for (const id of [dmUserId, playerUserId, otherPlayerUserId]) {
      if (id) await pool.query(`DELETE FROM users WHERE id = $1`, [id]);
    }
    await pool.end();
  });

  it('the uploader can rename their own asset', async () => {
    const updated = await updateAssetTitle(pool, playerUserId, assetId, 'Renamed by uploader');
    expect(updated.title).toBe('Renamed by uploader');
  });

  it('the DM can rename anyone\'s asset in their campaign', async () => {
    const updated = await updateAssetTitle(pool, dmUserId, assetId, 'Renamed by DM');
    expect(updated.title).toBe('Renamed by DM');
  });

  it('a different player cannot rename someone else\'s asset', async () => {
    await expect(updateAssetTitle(pool, otherPlayerUserId, assetId, 'Hijacked title')).rejects.toThrow(AppError);
  });

  it('updates updated_at but leaves created_at untouched', async () => {
    const before = await pool.query<{ created_at: string; updated_at: string }>(
      `SELECT created_at, updated_at FROM campaign_assets WHERE id = $1`,
      [assetId],
    );
    const originalCreatedAt = before.rows[0]!.created_at;
    const originalUpdatedAt = before.rows[0]!.updated_at;

    await new Promise((resolve) => setTimeout(resolve, 10));
    const updated = await updateAssetTitle(pool, playerUserId, assetId, 'Timestamp check');

    expect(updated.created_at).toEqual(originalCreatedAt);
    expect(new Date(updated.updated_at).getTime()).toBeGreaterThan(new Date(originalUpdatedAt).getTime());
  });
});

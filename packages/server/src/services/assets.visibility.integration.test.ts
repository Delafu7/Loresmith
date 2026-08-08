// Regression test for the Iteration 4 fix — campaign_assets.visible_to_players
// existed as a column since the original migration but was never read
// (listAssets returned every row to every role) or written (no route/schema
// exposed it). Covers both halves: listAssets' role-scoped SQL filter and
// the new updateAssetVisibility authorization (DM or uploader only, same
// convention as updateAssetTitle). Throwaway campaign/user/asset fixtures,
// same isolation convention as assets.updateTitle.integration.test.ts.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../db/pool.js';
import { listAssets, updateAssetVisibility } from './assets.js';
import { AppError } from '../middleware/errors.js';

describe('campaign_assets visible_to_players (integration, live DB, throwaway fixtures)', () => {
  let dmUserId: string;
  let playerUserId: string;
  let otherPlayerUserId: string;
  let campaignId: string;
  let publicAssetId: string;
  let gmOnlyAssetId: string;

  beforeAll(async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const dmRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'Asset Visibility Test DM', 'x') RETURNING id`,
      [`asset-visibility-dm-${suffix}@example.test`],
    );
    dmUserId = dmRes.rows[0]!.id;

    const playerRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'Asset Visibility Test Player', 'x') RETURNING id`,
      [`asset-visibility-player-${suffix}@example.test`],
    );
    playerUserId = playerRes.rows[0]!.id;

    const otherRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'Asset Visibility Test Other Player', 'x') RETURNING id`,
      [`asset-visibility-other-${suffix}@example.test`],
    );
    otherPlayerUserId = otherRes.rows[0]!.id;

    const campaignRes = await pool.query<{ id: string }>(
      `INSERT INTO campaigns (name, dm_user_id, srd_edition) VALUES ('Asset Visibility Test Campaign', $1, '2024') RETURNING id`,
      [dmUserId],
    );
    campaignId = campaignRes.rows[0]!.id;
    await pool.query(`INSERT INTO campaign_members (campaign_id, user_id, role) VALUES ($1, $2, 'dm')`, [campaignId, dmUserId]);
    await pool.query(`INSERT INTO campaign_members (campaign_id, user_id, role) VALUES ($1, $2, 'player')`, [campaignId, playerUserId]);
    await pool.query(`INSERT INTO campaign_members (campaign_id, user_id, role) VALUES ($1, $2, 'player')`, [
      campaignId,
      otherPlayerUserId,
    ]);

    const publicRes = await pool.query<{ id: string }>(
      `INSERT INTO campaign_assets (campaign_id, uploaded_by_user_id, asset_type, file_url, mime_type, file_size_bytes, title, visible_to_players)
       VALUES ($1, $2, 'image', '/uploads/campaigns/test/public.png', 'image/png', 1024, 'Public Asset', true)
       RETURNING id`,
      [campaignId, dmUserId],
    );
    publicAssetId = publicRes.rows[0]!.id;

    const gmOnlyRes = await pool.query<{ id: string }>(
      `INSERT INTO campaign_assets (campaign_id, uploaded_by_user_id, asset_type, file_url, mime_type, file_size_bytes, title, visible_to_players)
       VALUES ($1, $2, 'image', '/uploads/campaigns/test/gm-only.png', 'image/png', 1024, 'GM-Only Asset', false)
       RETURNING id`,
      [campaignId, dmUserId],
    );
    gmOnlyAssetId = gmOnlyRes.rows[0]!.id;
  });

  afterAll(async () => {
    if (campaignId) await pool.query(`DELETE FROM campaigns WHERE id = $1`, [campaignId]);
    for (const id of [dmUserId, playerUserId, otherPlayerUserId]) {
      if (id) await pool.query(`DELETE FROM users WHERE id = $1`, [id]);
    }
    await pool.end();
  });

  it('listAssets returns every asset to the DM', async () => {
    const rows = await listAssets(pool, campaignId, 'dm');
    expect(rows.map((r) => r.id).sort()).toEqual([publicAssetId, gmOnlyAssetId].sort());
  });

  it('listAssets excludes GM-only assets for a player', async () => {
    const rows = await listAssets(pool, campaignId, 'player');
    expect(rows.map((r) => r.id)).toEqual([publicAssetId]);
  });

  it('the DM can flip an asset to GM-only and back', async () => {
    const hidden = await updateAssetVisibility(pool, dmUserId, publicAssetId, false);
    expect(hidden.visible_to_players).toBe(false);
    expect((await listAssets(pool, campaignId, 'player')).map((r) => r.id)).not.toContain(publicAssetId);

    const revealed = await updateAssetVisibility(pool, dmUserId, publicAssetId, true);
    expect(revealed.visible_to_players).toBe(true);
    expect((await listAssets(pool, campaignId, 'player')).map((r) => r.id)).toContain(publicAssetId);
  });

  it('a player who did not upload the asset cannot change its visibility', async () => {
    await expect(updateAssetVisibility(pool, otherPlayerUserId, gmOnlyAssetId, true)).rejects.toThrow(AppError);
  });
});

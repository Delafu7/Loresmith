// Integration test for the Iteration 4 bestiary image gallery — a
// campaign_bestiary_entry_images join row attached via services/assets.ts's
// createAsset(bestiaryEntryId), listed through campaignBestiary.ts's
// listCampaignBestiary/getCampaignBestiaryEntry with the same
// visible_to_players role filter listAssets uses, and cascade-removed when
// the underlying asset is deleted (no dedicated remove-image endpoint).
// Throwaway campaign/user/monster fixtures, own file rather than appended to
// campaignBestiary.integration.test.ts since that file's later tests mutate
// (and one deletes) the shared entry fixture — separate fixtures avoid
// coupling test order across files.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../db/pool.js';
import { addToCampaignBestiary, listCampaignBestiary, getCampaignBestiaryEntry, updateCampaignBestiaryEntry } from './campaignBestiary.js';
import { authorizeAssetUpload, createAsset, deleteAsset } from './assets.js';
import { AppError } from '../middleware/errors.js';

describe('campaign bestiary image gallery (integration, live DB, throwaway fixtures)', () => {
  let dmUserId: string;
  let playerUserId: string;
  let campaignId: string;
  let monsterId: string;
  let entryId: string;

  beforeAll(async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const dmRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'Bestiary Image Test DM', 'x') RETURNING id`,
      [`bestiary-image-dm-${suffix}@example.test`],
    );
    dmUserId = dmRes.rows[0]!.id;

    const playerRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'Bestiary Image Test Player', 'x') RETURNING id`,
      [`bestiary-image-player-${suffix}@example.test`],
    );
    playerUserId = playerRes.rows[0]!.id;

    const campaignRes = await pool.query<{ id: string }>(
      `INSERT INTO campaigns (name, dm_user_id, srd_edition) VALUES ('Bestiary Image Test Campaign', $1, '2024') RETURNING id`,
      [dmUserId],
    );
    campaignId = campaignRes.rows[0]!.id;
    await pool.query(`INSERT INTO campaign_members (campaign_id, user_id, role) VALUES ($1, $2, 'dm')`, [campaignId, dmUserId]);
    await pool.query(`INSERT INTO campaign_members (campaign_id, user_id, role) VALUES ($1, $2, 'player')`, [campaignId, playerUserId]);

    const monsterRes = await pool.query<{ id: string }>(
      `INSERT INTO monsters
         (slug, name, edition_scope, size, creature_type, armor_class, hit_point_average, hit_dice, speed,
          str, dex, con, int, wis, cha, challenge_rating, xp_value, actions)
       VALUES ($1, 'Bestiary Image Test Goblin', 'both', 'Small', 'humanoid', 15, 7, '2d6',
               $2, 8, 14, 10, 10, 8, 8, 0.25, 50, $3)
       RETURNING id`,
      [`bestiary-image-goblin-${suffix}`, JSON.stringify({ walk: 30 }), JSON.stringify([])],
    );
    monsterId = monsterRes.rows[0]!.id;

    await addToCampaignBestiary(pool, campaignId, dmUserId, [monsterId]);
    const dmList = await listCampaignBestiary(pool, campaignId, 'dm');
    entryId = dmList.find((e) => e.monster_id === monsterId)!.id;
    // Discovered so the player-visibility assertions below exercise the
    // image filter itself, not the outer entry-level discovered gate.
    await updateCampaignBestiaryEntry(pool, campaignId, entryId, { discovered: true });
  });

  afterAll(async () => {
    if (campaignId) await pool.query(`DELETE FROM campaigns WHERE id = $1`, [campaignId]);
    if (monsterId) await pool.query(`DELETE FROM monsters WHERE id = $1`, [monsterId]);
    for (const id of [dmUserId, playerUserId]) {
      if (id) await pool.query(`DELETE FROM users WHERE id = $1`, [id]);
    }
    await pool.end();
  });

  it('a player cannot target an upload at a bestiary entry (DM-only, mirrors every other bestiary write)', async () => {
    await expect(
      authorizeAssetUpload(pool, campaignId, playerUserId, 'player', { bestiaryEntryId: entryId }),
    ).rejects.toThrow(AppError);
  });

  it('uploading with bestiaryEntryId attaches the image, visible to the DM', async () => {
    await createAsset(
      pool,
      campaignId,
      dmUserId,
      'dm',
      { bestiaryEntryId: entryId, visibleToPlayers: true },
      { path: '/tmp/bestiary-image-test-public.png', mimeType: 'image/png', sizeBytes: 1024 },
    );

    const entry = await getCampaignBestiaryEntry(pool, campaignId, entryId, 'dm');
    expect(entry.images).toHaveLength(1);
    expect(entry.images[0]!.visible_to_players).toBe(true);
  });

  it('a GM-only image is excluded from a player\'s view but present for the DM', async () => {
    await createAsset(
      pool,
      campaignId,
      dmUserId,
      'dm',
      { bestiaryEntryId: entryId, visibleToPlayers: false },
      { path: '/tmp/bestiary-image-test-gm-only.png', mimeType: 'image/png', sizeBytes: 1024 },
    );

    const dmEntry = await getCampaignBestiaryEntry(pool, campaignId, entryId, 'dm');
    expect(dmEntry.images).toHaveLength(2);

    const playerEntry = await getCampaignBestiaryEntry(pool, campaignId, entryId, 'player');
    expect(playerEntry.images).toHaveLength(1);
    expect(playerEntry.images.every((img) => img.visible_to_players)).toBe(true);

    const playerList = await listCampaignBestiary(pool, campaignId, 'player');
    const listedEntry = playerList.find((e) => e.id === entryId)!;
    expect(listedEntry.images).toHaveLength(1);
  });

  it('deleting the underlying asset cascades and removes it from the gallery', async () => {
    const before = await getCampaignBestiaryEntry(pool, campaignId, entryId, 'dm');
    const toDelete = before.images[0]!;

    await deleteAsset(pool, dmUserId, toDelete.asset_id);

    const after = await getCampaignBestiaryEntry(pool, campaignId, entryId, 'dm');
    expect(after.images.map((img) => img.asset_id)).not.toContain(toDelete.asset_id);
  });

  it('an upload targeting a bestiary entry from another campaign is rejected as not found', async () => {
    const otherCampaignRes = await pool.query<{ id: string }>(
      `INSERT INTO campaigns (name, dm_user_id, srd_edition) VALUES ('Bestiary Image Test Other Campaign', $1, '2024') RETURNING id`,
      [dmUserId],
    );
    const otherCampaignId = otherCampaignRes.rows[0]!.id;
    try {
      await expect(
        createAsset(
          pool,
          otherCampaignId,
          dmUserId,
          'dm',
          { bestiaryEntryId: entryId },
          { path: '/tmp/bestiary-image-test-cross-campaign.png', mimeType: 'image/png', sizeBytes: 1024 },
        ),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    } finally {
      await pool.query(`DELETE FROM campaigns WHERE id = $1`, [otherCampaignId]);
    }
  });
});

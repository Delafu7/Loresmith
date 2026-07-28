// Integration test for the Phase 1 "full CRUD incl. duplicate" requirement
// on the monster catalog — proves duplicateHomebrewMonster forks BOTH an
// official/global row and another campaign's homebrew row into a fresh
// homebrew row owned by the calling campaign, with a fresh unique slug, the
// calling campaign's own edition_scope, and a cross-campaign art_asset_id
// dropped rather than copied verbatim. Throwaway fixtures, same isolation
// convention as characters.duplicate.integration.test.ts.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../db/pool.js';
import { duplicateHomebrewMonster } from './monsterCatalog.js';
import { AppError } from '../middleware/errors.js';

describe('duplicateHomebrewMonster (integration, live DB, throwaway fixtures)', () => {
  let dmUserId: string;
  let campaignId: string;
  let otherCampaignId: string;
  let globalMonsterId: string;
  let otherCampaignMonsterId: string;
  let otherCampaignAssetId: string;
  const createdMonsterIds: string[] = [];

  beforeAll(async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const dmRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'Duplicate Monster Test DM', 'x') RETURNING id`,
      [`duplicate-monster-dm-${suffix}@example.test`],
    );
    dmUserId = dmRes.rows[0]!.id;

    const campaignRes = await pool.query<{ id: string }>(
      `INSERT INTO campaigns (name, dm_user_id, srd_edition) VALUES ('Duplicate Monster Test Campaign', $1, '2024') RETURNING id`,
      [dmUserId],
    );
    campaignId = campaignRes.rows[0]!.id;
    await pool.query(`INSERT INTO campaign_members (campaign_id, user_id, role) VALUES ($1, $2, 'dm')`, [campaignId, dmUserId]);

    const otherCampaignRes = await pool.query<{ id: string }>(
      `INSERT INTO campaigns (name, dm_user_id, srd_edition) VALUES ('Other Campaign (2014)', $1, '2014') RETURNING id`,
      [dmUserId],
    );
    otherCampaignId = otherCampaignRes.rows[0]!.id;
    await pool.query(`INSERT INTO campaign_members (campaign_id, user_id, role) VALUES ($1, $2, 'dm')`, [otherCampaignId, dmUserId]);

    const globalRes = await pool.query<{ id: string }>(
      `INSERT INTO monsters
         (slug, name, edition_scope, size, creature_type, armor_class, hit_point_average, hit_dice, speed,
          str, dex, con, int, wis, cha, damage_resistances, challenge_rating, xp_value, actions, is_homebrew)
       VALUES ($1, 'Test Global Goblin', 'both', 'Small', 'humanoid', 15, 7, '2d6', '{"walk":30}',
               8, 14, 10, 10, 8, 8, ARRAY['cold'], 0.25, 50, '[{"name":"Scimitar","description":"Melee.","attackBonus":4}]', false)
       RETURNING id`,
      [`test-global-goblin-${suffix}`],
    );
    globalMonsterId = globalRes.rows[0]!.id;
    createdMonsterIds.push(globalMonsterId);

    const assetRes = await pool.query<{ id: string }>(
      `INSERT INTO campaign_assets (campaign_id, uploaded_by_user_id, asset_type, file_url, mime_type, file_size_bytes)
       VALUES ($1, $2, 'image', 'https://example.test/other-campaign-art.png', 'image/png', 1024) RETURNING id`,
      [otherCampaignId, dmUserId],
    );
    otherCampaignAssetId = assetRes.rows[0]!.id;

    const otherRes = await pool.query<{ id: string }>(
      `INSERT INTO monsters
         (slug, name, edition_scope, size, creature_type, armor_class, hit_point_average, hit_dice, speed,
          str, dex, con, int, wis, cha, challenge_rating, xp_value, actions, is_homebrew, owning_campaign_id, art_asset_id)
       VALUES ($1, 'Other Campaign Ooze', '2014', 'Medium', 'ooze', 8, 22, '4d8', '{"walk":10}',
               12, 6, 16, 1, 6, 1, 1, 200, '[{"name":"Pseudopod","description":"Melee.","attackBonus":3}]',
               true, $2, $3)
       RETURNING id`,
      [`test-other-ooze-${suffix}`, otherCampaignId, otherCampaignAssetId],
    );
    otherCampaignMonsterId = otherRes.rows[0]!.id;
    createdMonsterIds.push(otherCampaignMonsterId);
  });

  afterAll(async () => {
    for (const id of createdMonsterIds) await pool.query(`DELETE FROM monsters WHERE id = $1`, [id]);
    if (campaignId) await pool.query(`DELETE FROM campaigns WHERE id = $1`, [campaignId]);
    if (otherCampaignId) await pool.query(`DELETE FROM campaigns WHERE id = $1`, [otherCampaignId]);
    if (dmUserId) await pool.query(`DELETE FROM users WHERE id = $1`, [dmUserId]);
    await pool.end();
  });

  it('forks an official/global monster into a homebrew row owned by the calling campaign', async () => {
    const copy = await duplicateHomebrewMonster(pool, campaignId, globalMonsterId);
    createdMonsterIds.push(copy.id as string);

    expect(copy.name).toBe('Test Global Goblin');
    expect(copy.id).not.toBe(globalMonsterId);
    expect(copy.is_homebrew).toBe(true);
    expect(copy.owning_campaign_id).toBe(campaignId);
    expect(copy.slug).not.toBe((await pool.query(`SELECT slug FROM monsters WHERE id = $1`, [globalMonsterId])).rows[0].slug);
    expect(copy.edition_scope).toBe('2024'); // the calling campaign's own edition, not the source's 'both'
    expect(copy.damage_resistances).toEqual(['cold']);
    expect(copy.actions).toEqual([{ name: 'Scimitar', description: 'Melee.', attackBonus: 4 }]);
    expect(copy.speed).toEqual({ walk: 30 });
  });

  it('forks another campaign\'s homebrew monster and drops the cross-campaign art_asset_id', async () => {
    const copy = await duplicateHomebrewMonster(pool, campaignId, otherCampaignMonsterId);
    createdMonsterIds.push(copy.id as string);

    expect(copy.name).toBe('Other Campaign Ooze');
    expect(copy.owning_campaign_id).toBe(campaignId);
    expect(copy.edition_scope).toBe('2024');
    expect(copy.art_asset_id).toBeNull(); // source's art belongs to otherCampaignId, not campaignId
  });

  it('404s for a nonexistent source monster', async () => {
    await expect(
      duplicateHomebrewMonster(pool, campaignId, '00000000-0000-0000-0000-000000000000'),
    ).rejects.toThrow(AppError);
  });
});

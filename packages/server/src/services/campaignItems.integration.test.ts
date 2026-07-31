// Integration test for the campaign item stash (services/campaignItems.ts —
// nav point 5's "global item repository"). Covers the three things the plan
// explicitly calls out: import creates a campaign-owned instance without
// touching the catalog template, editing that instance never affects other
// campaigns, and the give-to-character transition moves the row (same id)
// rather than delete+recreate. Throwaway campaign/user/character fixtures,
// same isolation convention as catalogHomebrew.integration.test.ts.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../db/pool.js';
import {
  giveCampaignStashItemToCharacter,
  importCampaignStashItem,
  listCampaignStashItems,
  removeCampaignStashItem,
  updateCampaignStashItem,
} from './campaignItems.js';

describe('campaign item stash (integration, live DB, throwaway fixtures)', () => {
  let dmUserId: string;
  let campaignId: string;
  let otherCampaignId: string;
  let characterId: string;
  let otherCampaignCharacterId: string;
  let globalItemId: string;

  beforeAll(async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const dmRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'Stash Test DM', 'x') RETURNING id`,
      [`campaign-items-dm-${suffix}@example.test`],
    );
    dmUserId = dmRes.rows[0]!.id;

    const campaignRes = await pool.query<{ id: string }>(
      `INSERT INTO campaigns (name, dm_user_id, srd_edition) VALUES ('Stash Test Campaign', $1, '2024') RETURNING id`,
      [dmUserId],
    );
    campaignId = campaignRes.rows[0]!.id;
    await pool.query(`INSERT INTO campaign_members (campaign_id, user_id, role) VALUES ($1, $2, 'dm')`, [campaignId, dmUserId]);

    const otherCampaignRes = await pool.query<{ id: string }>(
      `INSERT INTO campaigns (name, dm_user_id, srd_edition) VALUES ('Other Stash Campaign', $1, '2024') RETURNING id`,
      [dmUserId],
    );
    otherCampaignId = otherCampaignRes.rows[0]!.id;
    await pool.query(`INSERT INTO campaign_members (campaign_id, user_id, role) VALUES ($1, $2, 'dm')`, [otherCampaignId, dmUserId]);

    const charRes = await pool.query<{ id: string }>(
      `INSERT INTO characters (campaign_id, is_pc, owner_user_id, created_by_user_id, name, str, dex, con, int, wis, cha, armor_class, hp_max, hp_current)
       VALUES ($1, true, $2, $2, 'Stash Test Fighter', 10, 10, 10, 10, 10, 10, 10, 10, 10)
       RETURNING id`,
      [campaignId, dmUserId],
    );
    characterId = charRes.rows[0]!.id;

    const otherCharRes = await pool.query<{ id: string }>(
      `INSERT INTO characters (campaign_id, is_pc, owner_user_id, created_by_user_id, name, str, dex, con, int, wis, cha, armor_class, hp_max, hp_current)
       VALUES ($1, true, $2, $2, 'Other Campaign Fighter', 10, 10, 10, 10, 10, 10, 10, 10, 10)
       RETURNING id`,
      [otherCampaignId, dmUserId],
    );
    otherCampaignCharacterId = otherCharRes.rows[0]!.id;

    const itemRes = await pool.query<{ id: string }>(`SELECT id FROM items WHERE is_homebrew = false LIMIT 1`);
    globalItemId = itemRes.rows[0]!.id;
  });

  afterAll(async () => {
    try {
      if (campaignId) await pool.query(`DELETE FROM campaigns WHERE id = $1`, [campaignId]);
      if (otherCampaignId) await pool.query(`DELETE FROM campaigns WHERE id = $1`, [otherCampaignId]);
    } finally {
      if (dmUserId) await pool.query(`DELETE FROM users WHERE id = $1`, [dmUserId]);
      await pool.end();
    }
  });

  it('importing a catalog item creates a campaign-owned stash row, leaving the catalog template untouched', async () => {
    const before = await pool.query(`SELECT * FROM items WHERE id = $1`, [globalItemId]);

    const row = await importCampaignStashItem(pool, campaignId, {
      itemId: globalItemId,
      quantity: 3,
      customName: null,
      chargesRemaining: null,
      notes: null,
    });

    expect(row.campaign_id).toBe(campaignId);
    expect(row.character_id).toBeNull();
    expect(row.monster_instance_id).toBeNull();
    expect(row.item_id).toBe(globalItemId);
    expect(row.quantity).toBe(3);

    const afterTemplate = await pool.query(`SELECT * FROM items WHERE id = $1`, [globalItemId]);
    expect(afterTemplate.rows[0]).toEqual(before.rows[0]);

    const stash = await listCampaignStashItems(pool, campaignId);
    expect(stash.some((i: any) => i.id === row.id)).toBe(true);
  });

  it('editing a stash instance never affects another campaign, and is invisible to that campaign\'s stash list', async () => {
    const row = await importCampaignStashItem(pool, campaignId, {
      itemId: globalItemId,
      quantity: 1,
      customName: null,
      chargesRemaining: null,
      notes: null,
    });

    const otherStashBefore = await listCampaignStashItems(pool, otherCampaignId);
    expect(otherStashBefore.some((i: any) => i.id === row.id)).toBe(false);

    const updated = await updateCampaignStashItem(pool, campaignId, row.id as string, { quantity: 5, customName: 'Renamed' });
    expect(updated.quantity).toBe(5);
    expect(updated.custom_name).toBe('Renamed');

    // Cross-campaign update is a no-op 404 — the WHERE clause scopes on
    // campaign_id, so a DM of otherCampaignId can't reach this row at all.
    await expect(
      updateCampaignStashItem(pool, otherCampaignId, row.id as string, { quantity: 99 }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    const stillFive = await pool.query(`SELECT quantity FROM character_items WHERE id = $1`, [row.id]);
    expect(stillFive.rows[0].quantity).toBe(5);
  });

  it('giving a stash item to a character moves the same row (same id), and rejects a character from another campaign', async () => {
    const row = await importCampaignStashItem(pool, campaignId, {
      itemId: globalItemId,
      quantity: 2,
      customName: 'Ready to give',
      chargesRemaining: null,
      notes: null,
    });

    await expect(
      giveCampaignStashItemToCharacter(pool, campaignId, row.id as string, otherCampaignCharacterId),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    const given = await giveCampaignStashItemToCharacter(pool, campaignId, row.id as string, characterId);
    expect(given.id).toBe(row.id);
    expect(given.character_id).toBe(characterId);
    expect(given.campaign_id).toBeNull();
    expect(given.custom_name).toBe('Ready to give');
    expect(given.quantity).toBe(2);

    const stashAfter = await listCampaignStashItems(pool, campaignId);
    expect(stashAfter.some((i: any) => i.id === row.id)).toBe(false);

    const onCharacter = await pool.query(`SELECT * FROM character_items WHERE character_id = $1 AND id = $2`, [characterId, row.id]);
    expect(onCharacter.rowCount).toBe(1);
  });

  it('removing a stash item deletes only that row', async () => {
    const row = await importCampaignStashItem(pool, campaignId, {
      itemId: globalItemId,
      quantity: 1,
      customName: null,
      chargesRemaining: null,
      notes: null,
    });
    await removeCampaignStashItem(pool, campaignId, row.id as string);
    const gone = await pool.query(`SELECT 1 FROM character_items WHERE id = $1`, [row.id]);
    expect(gone.rowCount).toBe(0);

    await expect(removeCampaignStashItem(pool, campaignId, row.id as string)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

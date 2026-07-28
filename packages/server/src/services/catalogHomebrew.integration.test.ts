// Integration test for the generic homebrew catalog CRUD (services/
// catalogHomebrew.ts + routes/catalogHomebrew.ts). Exercises two entities
// with meaningfully different shapes — damage_types (simplest: index_key +
// name + description) and items (the most field-heavy) — on the theory that
// if the generic layer is correct for the simplest and the most complex
// case, the other 9 tables it's parametrized over follow the same code
// path and don't need their own duplicate coverage. Throwaway campaign/user
// fixtures, same isolation convention as rests.performRest.integration.test.ts.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../db/pool.js';
import {
  createHomebrewCatalogRow,
  updateHomebrewCatalogRow,
  deleteHomebrewCatalogRow,
  duplicateCatalogRow,
} from './catalogHomebrew.js';
import { listDamageTypes, listItems } from './catalog.js';

describe('generic homebrew catalog CRUD (integration, live DB, throwaway fixtures)', () => {
  let dmUserId: string;
  let playerUserId: string;
  let campaignId: string;
  let otherCampaignId: string;
  let globalDamageTypeId: string;

  beforeAll(async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const dmRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'Catalog Test DM', 'x') RETURNING id`,
      [`catalog-homebrew-dm-${suffix}@example.test`],
    );
    dmUserId = dmRes.rows[0]!.id;

    const playerRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'Catalog Test Player', 'x') RETURNING id`,
      [`catalog-homebrew-player-${suffix}@example.test`],
    );
    playerUserId = playerRes.rows[0]!.id;

    const campaignRes = await pool.query<{ id: string }>(
      `INSERT INTO campaigns (name, dm_user_id, srd_edition) VALUES ('Catalog Homebrew Test Campaign', $1, '2024') RETURNING id`,
      [dmUserId],
    );
    campaignId = campaignRes.rows[0]!.id;
    await pool.query(`INSERT INTO campaign_members (campaign_id, user_id, role) VALUES ($1, $2, 'dm')`, [campaignId, dmUserId]);
    await pool.query(`INSERT INTO campaign_members (campaign_id, user_id, role) VALUES ($1, $2, 'player')`, [campaignId, playerUserId]);

    const otherCampaignRes = await pool.query<{ id: string }>(
      `INSERT INTO campaigns (name, dm_user_id, srd_edition) VALUES ('Other Campaign', $1, '2024') RETURNING id`,
      [dmUserId],
    );
    otherCampaignId = otherCampaignRes.rows[0]!.id;
    // Same user is DM of both campaigns, on purpose — this isolates the
    // ownership check (owning_campaign_id must match) from the membership
    // check (requireMembership), which would otherwise also block a
    // different-user cross-campaign attempt and mask which check actually fired.
    await pool.query(`INSERT INTO campaign_members (campaign_id, user_id, role) VALUES ($1, $2, 'dm')`, [otherCampaignId, dmUserId]);

    const globalRes = await pool.query<{ id: string }>(`SELECT id FROM damage_types WHERE is_homebrew = false LIMIT 1`);
    globalDamageTypeId = globalRes.rows[0]!.id;
  });

  afterAll(async () => {
    try {
      if (campaignId) await pool.query(`DELETE FROM campaigns WHERE id = $1`, [campaignId]);
      if (otherCampaignId) await pool.query(`DELETE FROM campaigns WHERE id = $1`, [otherCampaignId]);
    } finally {
      if (dmUserId) await pool.query(`DELETE FROM users WHERE id = $1`, [dmUserId]);
      if (playerUserId) await pool.query(`DELETE FROM users WHERE id = $1`, [playerUserId]);
      await pool.end();
    }
  });

  const damageTypeConfig = { table: 'damage_types', keyColumn: 'index_key' as const };
  const itemConfig = { table: 'items', keyColumn: 'slug' as const };

  it('a DM can create a homebrew damage type scoped to their campaign, with a suffixed index_key', async () => {
    const row = await createHomebrewCatalogRow(pool, dmUserId, campaignId, damageTypeConfig, {
      index_key: 'necrotic-fire',
      name: 'Necrotic Fire',
      description: 'A homebrew damage type.',
    });
    expect(row.name).toBe('Necrotic Fire');
    expect(row.is_homebrew).toBe(true);
    expect(row.owning_campaign_id).toBe(campaignId);
    expect(row.index_key).toMatch(/^necrotic-fire-[a-z0-9]{6}$/);
  });

  it('a player cannot create a homebrew row (DM-only)', async () => {
    await expect(
      createHomebrewCatalogRow(pool, playerUserId, campaignId, damageTypeConfig, { index_key: 'x', name: 'X' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN_ROLE' });
  });

  it('listDamageTypes unions the campaign homebrew row in only when campaignId is supplied', async () => {
    const created = await createHomebrewCatalogRow(pool, dmUserId, campaignId, damageTypeConfig, {
      index_key: 'sonic-frost',
      name: 'Sonic Frost',
    });

    const globalOnly = await listDamageTypes(pool, {});
    expect(globalOnly.some((r: any) => r.id === created.id)).toBe(false);

    const withCampaign = await listDamageTypes(pool, { campaignId });
    expect(withCampaign.some((r: any) => r.id === created.id)).toBe(true);

    const otherCampaign = await listDamageTypes(pool, { campaignId: otherCampaignId });
    expect(otherCampaign.some((r: any) => r.id === created.id)).toBe(false);
  });

  it('a DM can update and delete their own homebrew row, but not one owned by another campaign', async () => {
    const row = await createHomebrewCatalogRow(pool, dmUserId, campaignId, damageTypeConfig, {
      index_key: 'acid-void',
      name: 'Acid Void',
    });

    const updated = await updateHomebrewCatalogRow(pool, dmUserId, campaignId, damageTypeConfig, row.id as string, {
      name: 'Acid Void (Revised)',
    });
    expect(updated.name).toBe('Acid Void (Revised)');
    expect(updated.updated_at).not.toBe(updated.created_at);

    await expect(
      updateHomebrewCatalogRow(pool, dmUserId, otherCampaignId, damageTypeConfig, row.id as string, { name: 'Stolen' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    await deleteHomebrewCatalogRow(pool, dmUserId, campaignId, damageTypeConfig, row.id as string);
    const gone = await pool.query(`SELECT 1 FROM damage_types WHERE id = $1`, [row.id]);
    expect(gone.rowCount).toBe(0);
  });

  it('a global row cannot be edited or deleted through the homebrew path (404s, not 403s)', async () => {
    await expect(
      updateHomebrewCatalogRow(pool, dmUserId, campaignId, damageTypeConfig, globalDamageTypeId, { name: 'Hacked' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      deleteHomebrewCatalogRow(pool, dmUserId, campaignId, damageTypeConfig, globalDamageTypeId),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('duplicating a global row forks it into a new homebrew row, leaving the original untouched', async () => {
    const before = await pool.query(`SELECT * FROM damage_types WHERE id = $1`, [globalDamageTypeId]);
    const copy = await duplicateCatalogRow(pool, dmUserId, campaignId, damageTypeConfig, globalDamageTypeId);

    expect(copy.id).not.toBe(globalDamageTypeId);
    expect(copy.is_homebrew).toBe(true);
    expect(copy.owning_campaign_id).toBe(campaignId);
    expect(copy.name).toBe(before.rows[0].name);
    expect(copy.index_key).toMatch(new RegExp(`^${before.rows[0].index_key}-copy-[a-z0-9]{6}$`));

    const originalStillGlobal = await pool.query(`SELECT is_homebrew, owning_campaign_id FROM damage_types WHERE id = $1`, [
      globalDamageTypeId,
    ]);
    expect(originalStillGlobal.rows[0].is_homebrew).toBe(false);
    expect(originalStillGlobal.rows[0].owning_campaign_id).toBeNull();

    // Now editable, since the DM owns the copy (fork-on-edit's whole point).
    const edited = await updateHomebrewCatalogRow(pool, dmUserId, campaignId, damageTypeConfig, copy.id as string, {
      name: 'My Custom Version',
    });
    expect(edited.name).toBe('My Custom Version');
  });

  it('handles a field-heavy table (items) the same way, including JSONB and array-ish columns', async () => {
    const row = await createHomebrewCatalogRow(pool, dmUserId, campaignId, itemConfig, {
      slug: 'flametongue-dagger',
      name: 'Flametongue Dagger',
      edition_scope: '2024',
      item_type: 'weapon',
      rarity: 'rare',
      damage_dice: '1d4',
      requires_attunement: true,
      stealth_disadvantage: false,
      properties: { finesse: true, light: true },
      description: 'A homebrew magic dagger.',
    });
    expect(row.name).toBe('Flametongue Dagger');
    expect(row.properties).toEqual({ finesse: true, light: true });
    expect(row.slug).toMatch(/^flametongue-dagger-[a-z0-9]{6}$/);

    const list = await listItems(pool, { campaignId });
    expect(list.some((i: any) => i.id === row.id)).toBe(true);

    await deleteHomebrewCatalogRow(pool, dmUserId, campaignId, itemConfig, row.id as string);
  });
});

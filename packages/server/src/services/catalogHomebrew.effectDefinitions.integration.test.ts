// Integration test for effect_definitions on the generic homebrew catalog
// (services/catalogHomebrew.ts + routes/catalogHomebrew.ts). Separate from
// catalogHomebrew.integration.test.ts because effect_definitions is the one
// table with keyColumn: null — no slug/index_key column, no UNIQUE
// constraint to dodge — so every assertion here specifically checks that
// `name` (the field that would be the key column elsewhere) is copied/
// created VERBATIM, never suffixed. Same throwaway fixture/isolation
// convention as the existing generic test.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../db/pool.js';
import {
  createHomebrewCatalogRow,
  updateHomebrewCatalogRow,
  deleteHomebrewCatalogRow,
  duplicateCatalogRow,
} from './catalogHomebrew.js';
import { listEffectDefinitions } from './catalog.js';

describe('generic homebrew catalog CRUD for effect_definitions (keyColumn: null) (integration, live DB, throwaway fixtures)', () => {
  let dmUserId: string;
  let playerUserId: string;
  let campaignId: string;
  let otherCampaignId: string;
  let globalEffectDefinitionId: string;

  beforeAll(async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const dmRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'Effect Def Test DM', 'x') RETURNING id`,
      [`effect-def-homebrew-dm-${suffix}@example.test`],
    );
    dmUserId = dmRes.rows[0]!.id;

    const playerRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'Effect Def Test Player', 'x') RETURNING id`,
      [`effect-def-homebrew-player-${suffix}@example.test`],
    );
    playerUserId = playerRes.rows[0]!.id;

    const campaignRes = await pool.query<{ id: string }>(
      `INSERT INTO campaigns (name, dm_user_id, srd_edition) VALUES ('Effect Def Homebrew Test Campaign', $1, '2024') RETURNING id`,
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
    // Same user is DM of both campaigns, on purpose — isolates the ownership
    // check (owning_campaign_id must match) from the membership check
    // (requireMembership), which would otherwise also block a
    // different-user cross-campaign attempt and mask which check actually fired.
    await pool.query(`INSERT INTO campaign_members (campaign_id, user_id, role) VALUES ($1, $2, 'dm')`, [otherCampaignId, dmUserId]);

    const globalRes = await pool.query<{ id: string }>(`SELECT id FROM effect_definitions WHERE is_homebrew = false LIMIT 1`);
    globalEffectDefinitionId = globalRes.rows[0]!.id;
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

  const effectDefinitionConfig = { table: 'effect_definitions', keyColumn: null as const };

  it('a DM can create a homebrew effect definition, with `name` left completely unsuffixed', async () => {
    const row = await createHomebrewCatalogRow(pool, dmUserId, campaignId, effectDefinitionConfig, {
      name: 'Marked for Death',
      description: 'A homebrew effect.',
      default_duration_type: 'rounds',
      default_duration_value: 3,
      concentration: false,
      stacking_rule: 'refresh',
    });
    // The whole point of keyColumn: null — no other field here is the "key
    // column", so nothing gets a random suffix appended.
    expect(row.name).toBe('Marked for Death');
    expect(row.is_homebrew).toBe(true);
    expect(row.owning_campaign_id).toBe(campaignId);
  });

  it('a non-DM (player) cannot create a homebrew effect definition', async () => {
    await expect(
      createHomebrewCatalogRow(pool, playerUserId, campaignId, effectDefinitionConfig, {
        name: 'Not Allowed',
        default_duration_type: 'rounds',
        concentration: false,
        stacking_rule: 'refresh',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN_ROLE' });
  });

  it('listEffectDefinitions unions the campaign homebrew row in only when campaignId is supplied', async () => {
    const created = await createHomebrewCatalogRow(pool, dmUserId, campaignId, effectDefinitionConfig, {
      name: 'Sundered Aura',
      default_duration_type: 'minutes',
      default_duration_value: 10,
      concentration: true,
      stacking_rule: 'none',
    });

    const globalOnly = await listEffectDefinitions(pool, {});
    expect(globalOnly.some((r: any) => r.id === created.id)).toBe(false);

    const withCampaign = await listEffectDefinitions(pool, { campaignId });
    expect(withCampaign.some((r: any) => r.id === created.id)).toBe(true);

    const otherCampaign = await listEffectDefinitions(pool, { campaignId: otherCampaignId });
    expect(otherCampaign.some((r: any) => r.id === created.id)).toBe(false);
  });

  it('a DM can update and delete their own homebrew row, but not one owned by another campaign', async () => {
    const row = await createHomebrewCatalogRow(pool, dmUserId, campaignId, effectDefinitionConfig, {
      name: 'Frostbitten',
      default_duration_type: 'hours',
      default_duration_value: 1,
      concentration: false,
      stacking_rule: 'stack',
    });

    const updated = await updateHomebrewCatalogRow(pool, dmUserId, campaignId, effectDefinitionConfig, row.id as string, {
      name: 'Frostbitten (Revised)',
    });
    expect(updated.name).toBe('Frostbitten (Revised)');
    expect(updated.updated_at).not.toBe(updated.created_at);

    await expect(
      updateHomebrewCatalogRow(pool, dmUserId, otherCampaignId, effectDefinitionConfig, row.id as string, { name: 'Stolen' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    await deleteHomebrewCatalogRow(pool, dmUserId, campaignId, effectDefinitionConfig, row.id as string);
    const gone = await pool.query(`SELECT 1 FROM effect_definitions WHERE id = $1`, [row.id]);
    expect(gone.rowCount).toBe(0);
  });

  it('a global row cannot be edited or deleted through the homebrew path (404s, not 403s)', async () => {
    await expect(
      updateHomebrewCatalogRow(pool, dmUserId, campaignId, effectDefinitionConfig, globalEffectDefinitionId, { name: 'Hacked' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      deleteHomebrewCatalogRow(pool, dmUserId, campaignId, effectDefinitionConfig, globalEffectDefinitionId),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('duplicating a global row forks it into a new homebrew row, copying `name` VERBATIM (no -copy suffix), leaving the original untouched', async () => {
    const before = await pool.query(`SELECT * FROM effect_definitions WHERE id = $1`, [globalEffectDefinitionId]);
    const copy = await duplicateCatalogRow(pool, dmUserId, campaignId, effectDefinitionConfig, globalEffectDefinitionId);

    expect(copy.id).not.toBe(globalEffectDefinitionId);
    expect(copy.is_homebrew).toBe(true);
    expect(copy.owning_campaign_id).toBe(campaignId);
    // No keyColumn to re-suffix here — `name` (unlike in the other 11
    // tables, where an analogous field IS the key column) is copied exactly.
    expect(copy.name).toBe(before.rows[0].name);
    expect(copy.default_duration_type).toBe(before.rows[0].default_duration_type);
    expect(copy.stacking_rule).toBe(before.rows[0].stacking_rule);

    const originalStillGlobal = await pool.query(
      `SELECT is_homebrew, owning_campaign_id FROM effect_definitions WHERE id = $1`,
      [globalEffectDefinitionId],
    );
    expect(originalStillGlobal.rows[0].is_homebrew).toBe(false);
    expect(originalStillGlobal.rows[0].owning_campaign_id).toBeNull();

    // Now editable, since the DM owns the copy (fork-on-edit's whole point).
    const edited = await updateHomebrewCatalogRow(pool, dmUserId, campaignId, effectDefinitionConfig, copy.id as string, {
      name: 'My Custom Version',
    });
    expect(edited.name).toBe('My Custom Version');

    await deleteHomebrewCatalogRow(pool, dmUserId, campaignId, effectDefinitionConfig, copy.id as string);
  });
});

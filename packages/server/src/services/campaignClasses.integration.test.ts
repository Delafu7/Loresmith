// Integration test for per-campaign class curation (services/
// campaignClasses.ts). Mirrors campaignRaces.integration.test.ts exactly,
// swapped to the classes catalog table.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../db/pool.js';
import {
  addToCampaignClasses,
  getCampaignClassEntry,
  listCampaignClasses,
  removeCampaignClassEntries,
  removeCampaignClassEntry,
  updateCampaignClassEntry,
} from './campaignClasses.js';

describe('campaign class curation (integration, live DB, throwaway fixtures)', () => {
  let dmUserId: string;
  let campaignId: string;
  let otherCampaignId: string;
  let globalClassId: string;

  beforeAll(async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const dmRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'Class Entries Test DM', 'x') RETURNING id`,
      [`campaign-classes-dm-${suffix}@example.test`],
    );
    dmUserId = dmRes.rows[0]!.id;

    const campaignRes = await pool.query<{ id: string }>(
      `INSERT INTO campaigns (name, dm_user_id, srd_edition) VALUES ('Class Entries Test Campaign', $1, '2024') RETURNING id`,
      [dmUserId],
    );
    campaignId = campaignRes.rows[0]!.id;
    await pool.query(`INSERT INTO campaign_members (campaign_id, user_id, role) VALUES ($1, $2, 'dm')`, [campaignId, dmUserId]);

    const otherCampaignRes = await pool.query<{ id: string }>(
      `INSERT INTO campaigns (name, dm_user_id, srd_edition) VALUES ('Other Class Entries Campaign', $1, '2024') RETURNING id`,
      [dmUserId],
    );
    otherCampaignId = otherCampaignRes.rows[0]!.id;
    await pool.query(`INSERT INTO campaign_members (campaign_id, user_id, role) VALUES ($1, $2, 'dm')`, [otherCampaignId, dmUserId]);

    const classRes = await pool.query<{ id: string }>(`SELECT id FROM classes WHERE is_homebrew = false LIMIT 1`);
    globalClassId = classRes.rows[0]!.id;
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

  it('importing a global class creates a campaign entry, leaving the catalog template untouched', async () => {
    const before = await pool.query(`SELECT * FROM classes WHERE id = $1`, [globalClassId]);

    const result = await addToCampaignClasses(pool, campaignId, dmUserId, [globalClassId]);
    expect(result.added).toHaveLength(1);
    expect(result.alreadyAdded).toHaveLength(0);

    const afterTemplate = await pool.query(`SELECT * FROM classes WHERE id = $1`, [globalClassId]);
    expect(afterTemplate.rows[0]).toEqual(before.rows[0]);

    const entries = await listCampaignClasses(pool, campaignId);
    expect(entries.some((e) => e.class_id === globalClassId)).toBe(true);
  });

  it('re-importing the same class is a no-op (already added), and a campaign with zero imports lists empty', async () => {
    const again = await addToCampaignClasses(pool, campaignId, dmUserId, [globalClassId]);
    expect(again.added).toHaveLength(0);
    expect(again.alreadyAdded).toEqual([globalClassId]);

    const emptyList = await listCampaignClasses(pool, otherCampaignId);
    expect(emptyList).toEqual([]);
  });

  it('a local override in one campaign never affects the same class imported into a different campaign', async () => {
    // Uses its own fresh class (not globalClassId, already imported by
    // earlier tests) so `added[0]` is always populated regardless of order.
    const classRes = await pool.query<{ id: string }>(`SELECT id FROM classes WHERE is_homebrew = false AND id != $1 LIMIT 1`, [globalClassId]);
    const classId = classRes.rows[0]!.id;

    const mine = await addToCampaignClasses(pool, campaignId, dmUserId, [classId]);
    const myEntryId = (mine.added[0] as { id: string }).id;

    const theirs = await addToCampaignClasses(pool, otherCampaignId, dmUserId, [classId]);
    const theirEntryId = (theirs.added[0] as { id: string }).id;

    const updated = await updateCampaignClassEntry(pool, campaignId, myEntryId, {
      customName: 'Battle Cleric',
      overrides: { hitDie: 10 },
    });
    expect(updated.custom_name).toBe('Battle Cleric');
    expect((updated.effective as { hit_die: number }).hit_die).toBe(10);

    const theirEntry = await getCampaignClassEntry(pool, otherCampaignId, theirEntryId);
    expect(theirEntry.custom_name).toBeNull();
    expect(theirEntry.overrides).toEqual({});

    const template = await pool.query(`SELECT hit_die FROM classes WHERE id = $1`, [classId]);
    expect(template.rows[0]!.hit_die).not.toBe(10);
  });

  it('removing an entry deletes only that row and never the catalog class', async () => {
    const added = await addToCampaignClasses(pool, campaignId, dmUserId, [globalClassId]);
    const entryId = (added.added[0]?.id ?? (await listCampaignClasses(pool, campaignId)).find((e) => e.class_id === globalClassId)!.id) as string;

    await removeCampaignClassEntry(pool, campaignId, entryId);
    await expect(getCampaignClassEntry(pool, campaignId, entryId)).rejects.toMatchObject({ code: 'NOT_FOUND' });

    const templateStillThere = await pool.query(`SELECT 1 FROM classes WHERE id = $1`, [globalClassId]);
    expect(templateStillThere.rowCount).toBe(1);
  });

  it('bulk-remove deletes multiple entries by id and ignores unknown ids', async () => {
    const classRes = await pool.query<{ id: string }>(`SELECT id FROM classes WHERE is_homebrew = false AND id != $1 LIMIT 1`, [globalClassId]);
    const secondClassId = classRes.rows[0]!.id;

    await addToCampaignClasses(pool, campaignId, dmUserId, [globalClassId, secondClassId]);
    const entries = await listCampaignClasses(pool, campaignId);
    const entryIds = entries.map((e) => e.id);

    const result = await removeCampaignClassEntries(pool, campaignId, [...entryIds, '00000000-0000-0000-0000-000000000000']);
    expect(result.removed).toBe(entryIds.length);

    expect(await listCampaignClasses(pool, campaignId)).toEqual([]);
  });
});

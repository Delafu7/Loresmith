// Integration test for per-campaign race curation (services/
// campaignRaces.ts). Covers the target-state acceptance criteria: importing
// a global race leaves the catalog template untouched, a local override in
// one campaign never leaks into another campaign that also imported the same
// race, and removing an entry never touches the catalog row it referenced.
// Throwaway campaign/user fixtures, same isolation convention as
// campaignItems.integration.test.ts.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../db/pool.js';
import {
  addToCampaignRaces,
  getCampaignRaceEntry,
  listCampaignRaces,
  removeCampaignRaceEntries,
  removeCampaignRaceEntry,
  updateCampaignRaceEntry,
} from './campaignRaces.js';

describe('campaign race curation (integration, live DB, throwaway fixtures)', () => {
  let dmUserId: string;
  let campaignId: string;
  let otherCampaignId: string;
  let globalRaceId: string;

  beforeAll(async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const dmRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'Race Entries Test DM', 'x') RETURNING id`,
      [`campaign-races-dm-${suffix}@example.test`],
    );
    dmUserId = dmRes.rows[0]!.id;

    const campaignRes = await pool.query<{ id: string }>(
      `INSERT INTO campaigns (name, dm_user_id, srd_edition) VALUES ('Race Entries Test Campaign', $1, '2024') RETURNING id`,
      [dmUserId],
    );
    campaignId = campaignRes.rows[0]!.id;
    await pool.query(`INSERT INTO campaign_members (campaign_id, user_id, role) VALUES ($1, $2, 'dm')`, [campaignId, dmUserId]);

    const otherCampaignRes = await pool.query<{ id: string }>(
      `INSERT INTO campaigns (name, dm_user_id, srd_edition) VALUES ('Other Race Entries Campaign', $1, '2024') RETURNING id`,
      [dmUserId],
    );
    otherCampaignId = otherCampaignRes.rows[0]!.id;
    await pool.query(`INSERT INTO campaign_members (campaign_id, user_id, role) VALUES ($1, $2, 'dm')`, [otherCampaignId, dmUserId]);

    const raceRes = await pool.query<{ id: string }>(`SELECT id FROM races WHERE is_homebrew = false LIMIT 1`);
    globalRaceId = raceRes.rows[0]!.id;
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

  it('importing a global race creates a campaign entry, leaving the catalog template untouched', async () => {
    const before = await pool.query(`SELECT * FROM races WHERE id = $1`, [globalRaceId]);

    const result = await addToCampaignRaces(pool, campaignId, dmUserId, [globalRaceId]);
    expect(result.added).toHaveLength(1);
    expect(result.alreadyAdded).toHaveLength(0);

    const afterTemplate = await pool.query(`SELECT * FROM races WHERE id = $1`, [globalRaceId]);
    expect(afterTemplate.rows[0]).toEqual(before.rows[0]);

    const entries = await listCampaignRaces(pool, campaignId);
    expect(entries.some((e) => e.race_id === globalRaceId)).toBe(true);
  });

  it('re-importing the same race is a no-op (already added), and a campaign with zero imports lists empty', async () => {
    const again = await addToCampaignRaces(pool, campaignId, dmUserId, [globalRaceId]);
    expect(again.added).toHaveLength(0);
    expect(again.alreadyAdded).toEqual([globalRaceId]);

    const emptyList = await listCampaignRaces(pool, otherCampaignId);
    expect(emptyList).toEqual([]);
  });

  it('a local override in one campaign never affects the same race imported into a different campaign', async () => {
    // Uses its own fresh race (not globalRaceId, already imported by earlier
    // tests) so `added[0]` is always populated regardless of test order.
    const raceRes = await pool.query<{ id: string }>(`SELECT id FROM races WHERE is_homebrew = false AND id != $1 LIMIT 1`, [globalRaceId]);
    const raceId = raceRes.rows[0]!.id;

    const mine = await addToCampaignRaces(pool, campaignId, dmUserId, [raceId]);
    const myEntryId = (mine.added[0] as { id: string }).id;

    const theirs = await addToCampaignRaces(pool, otherCampaignId, dmUserId, [raceId]);
    const theirEntryId = (theirs.added[0] as { id: string }).id;

    const updated = await updateCampaignRaceEntry(pool, campaignId, myEntryId, {
      customName: 'Sun Elf of Silvermoon',
      overrides: { speed: 35 },
    });
    expect(updated.custom_name).toBe('Sun Elf of Silvermoon');
    expect((updated.effective as { speed: number }).speed).toBe(35);

    const theirEntry = await getCampaignRaceEntry(pool, otherCampaignId, theirEntryId);
    expect(theirEntry.custom_name).toBeNull();
    expect(theirEntry.overrides).toEqual({});

    const template = await pool.query(`SELECT speed FROM races WHERE id = $1`, [raceId]);
    expect(template.rows[0]!.speed).not.toBe(35);
  });

  it('removing an entry deletes only that row and never the catalog race', async () => {
    const added = await addToCampaignRaces(pool, campaignId, dmUserId, [globalRaceId]);
    const entryId = (added.added[0]?.id ?? (await listCampaignRaces(pool, campaignId)).find((e) => e.race_id === globalRaceId)!.id) as string;

    await removeCampaignRaceEntry(pool, campaignId, entryId);
    await expect(getCampaignRaceEntry(pool, campaignId, entryId)).rejects.toMatchObject({ code: 'NOT_FOUND' });

    const templateStillThere = await pool.query(`SELECT 1 FROM races WHERE id = $1`, [globalRaceId]);
    expect(templateStillThere.rowCount).toBe(1);
  });

  it('bulk-remove deletes multiple entries by id and ignores unknown ids', async () => {
    const raceRes = await pool.query<{ id: string }>(`SELECT id FROM races WHERE is_homebrew = false AND id != $1 LIMIT 1`, [globalRaceId]);
    const secondRaceId = raceRes.rows[0]!.id;

    await addToCampaignRaces(pool, campaignId, dmUserId, [globalRaceId, secondRaceId]);
    const entries = await listCampaignRaces(pool, campaignId);
    const entryIds = entries.map((e) => e.id);

    const result = await removeCampaignRaceEntries(pool, campaignId, [...entryIds, '00000000-0000-0000-0000-000000000000']);
    expect(result.removed).toBe(entryIds.length);

    expect(await listCampaignRaces(pool, campaignId)).toEqual([]);
  });
});

// Integration test for the per-campaign bestiary (Task 1): player-visibility
// filtering must hold at the query level (not just get-one), the
// additive/non-gating relationship with monster_instances must hold (adding/
// removing a bestiary entry never touches combat instances or the catalog
// row), and add-to-campaign must reject another campaign's homebrew
// creature. Throwaway campaign/user/monster fixtures, same isolation
// convention as entityFieldReveal.integration.test.ts.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../db/pool.js';
import {
  addToCampaignBestiary,
  listCampaignBestiary,
  getCampaignBestiaryEntry,
  updateCampaignBestiaryEntry,
  removeCampaignBestiaryEntry,
} from './campaignBestiary.js';
import { createMonsterInstance } from './monsters.js';

describe('campaign bestiary curation (integration, live DB, throwaway fixtures)', () => {
  let dmUserId: string;
  let playerUserId: string;
  let campaignId: string;
  let otherCampaignId: string;
  let monsterId: string;
  let otherCampaignHomebrewMonsterId: string;

  beforeAll(async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const dmRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'Bestiary Test DM', 'x') RETURNING id`,
      [`bestiary-test-dm-${suffix}@example.test`],
    );
    dmUserId = dmRes.rows[0]!.id;

    const playerRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'Bestiary Test Player', 'x') RETURNING id`,
      [`bestiary-test-player-${suffix}@example.test`],
    );
    playerUserId = playerRes.rows[0]!.id;

    const campaignRes = await pool.query<{ id: string }>(
      `INSERT INTO campaigns (name, dm_user_id, srd_edition) VALUES ('Bestiary Test Campaign', $1, '2024') RETURNING id`,
      [dmUserId],
    );
    campaignId = campaignRes.rows[0]!.id;
    const otherCampaignRes = await pool.query<{ id: string }>(
      `INSERT INTO campaigns (name, dm_user_id, srd_edition) VALUES ('Bestiary Test Other Campaign', $1, '2024') RETURNING id`,
      [dmUserId],
    );
    otherCampaignId = otherCampaignRes.rows[0]!.id;

    await pool.query(`INSERT INTO campaign_members (campaign_id, user_id, role) VALUES ($1, $2, 'dm')`, [campaignId, dmUserId]);
    await pool.query(`INSERT INTO campaign_members (campaign_id, user_id, role) VALUES ($1, $2, 'player')`, [campaignId, playerUserId]);

    const monsterRes = await pool.query<{ id: string }>(
      `INSERT INTO monsters
         (slug, name, edition_scope, size, creature_type, armor_class, hit_point_average, hit_dice, speed,
          str, dex, con, int, wis, cha, challenge_rating, xp_value, actions)
       VALUES ($1, 'Bestiary Test Goblin', 'both', 'Small', 'humanoid', 15, 7, '2d6',
               $2, 8, 14, 10, 10, 8, 8, 0.25, 50, $3)
       RETURNING id`,
      [`bestiary-test-goblin-${suffix}`, JSON.stringify({ walk: 30 }), JSON.stringify([{ name: 'Scimitar', description: 'melee attack' }])],
    );
    monsterId = monsterRes.rows[0]!.id;

    const otherHomebrewRes = await pool.query<{ id: string }>(
      `INSERT INTO monsters
         (slug, name, edition_scope, size, creature_type, armor_class, hit_point_average, hit_dice, speed,
          str, dex, con, int, wis, cha, challenge_rating, xp_value, actions, is_homebrew, owning_campaign_id)
       VALUES ($1, 'Other Campaign Homebrew Beast', 'both', 'Medium', 'beast', 12, 15, '3d8',
               $2, 12, 12, 12, 6, 10, 5, 1, 200, $3, true, $4)
       RETURNING id`,
      [`bestiary-test-other-homebrew-${suffix}`, JSON.stringify({ walk: 40 }), JSON.stringify([{ name: 'Bite', description: 'melee attack' }]), otherCampaignId],
    );
    otherCampaignHomebrewMonsterId = otherHomebrewRes.rows[0]!.id;
  });

  afterAll(async () => {
    try {
      if (campaignId) await pool.query(`DELETE FROM campaigns WHERE id = $1`, [campaignId]);
      if (otherCampaignId) await pool.query(`DELETE FROM campaigns WHERE id = $1`, [otherCampaignId]);
      if (monsterId) await pool.query(`DELETE FROM monsters WHERE id = $1`, [monsterId]);
      if (otherCampaignHomebrewMonsterId) await pool.query(`DELETE FROM monsters WHERE id = $1`, [otherCampaignHomebrewMonsterId]);
    } finally {
      if (dmUserId) await pool.query(`DELETE FROM users WHERE id = $1`, [dmUserId]);
      if (playerUserId) await pool.query(`DELETE FROM users WHERE id = $1`, [playerUserId]);
      await pool.end();
    }
  });

  it('bulk add is idempotent and rejects another campaign\'s homebrew monster', async () => {
    const first = await addToCampaignBestiary(pool, campaignId, dmUserId, [monsterId]);
    expect(first.added).toHaveLength(1);
    expect(first.alreadyAdded).toEqual([]);

    const second = await addToCampaignBestiary(pool, campaignId, dmUserId, [monsterId]);
    expect(second.added).toHaveLength(0);
    expect(second.alreadyAdded).toEqual([monsterId]);

    await expect(addToCampaignBestiary(pool, campaignId, dmUserId, [otherCampaignHomebrewMonsterId])).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('DM sees undiscovered entries in the list, a player does not', async () => {
    const dmList = await listCampaignBestiary(pool, campaignId, 'dm');
    const dmEntry = dmList.find((e) => e.monster_id === monsterId);
    expect(dmEntry).toBeDefined();
    expect(dmEntry!.discovered).toBe(false);

    const playerList = await listCampaignBestiary(pool, campaignId, 'player');
    expect(playerList.find((e) => e.monster_id === monsterId)).toBeUndefined();
  });

  it('a player gets NOT_FOUND (not FORBIDDEN) fetching an undiscovered entry by id', async () => {
    const dmList = await listCampaignBestiary(pool, campaignId, 'dm');
    const entryId = dmList.find((e) => e.monster_id === monsterId)!.id;

    await expect(getCampaignBestiaryEntry(pool, campaignId, entryId, 'player')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const dmView = await getCampaignBestiaryEntry(pool, campaignId, entryId, 'dm');
    expect(dmView.id).toBe(entryId);
  });

  it('stat_overrides persist, merge into effective, and discovered flips visibility to players', async () => {
    const dmList = await listCampaignBestiary(pool, campaignId, 'dm');
    const entryId = dmList.find((e) => e.monster_id === monsterId)!.id;

    const updated = await updateCampaignBestiaryEntry(pool, campaignId, entryId, {
      customName: 'Grix the Sneaky',
      statOverrides: { hitPointAverage: 99 },
      discovered: true,
    });

    expect(updated.custom_name).toBe('Grix the Sneaky');
    expect((updated.effective as { hit_point_average: number }).hit_point_average).toBe(99);
    // The catalog row itself must be untouched by the override.
    expect((updated.monster as { hit_point_average: number }).hit_point_average).toBe(7);
    expect(updated.discovered).toBe(true);

    const playerList = await listCampaignBestiary(pool, campaignId, 'player');
    expect(playerList.find((e) => e.id === entryId)).toBeDefined();

    // A second PATCH touching only notes must not clobber the earlier override.
    const secondUpdate = await updateCampaignBestiaryEntry(pool, campaignId, entryId, { notes: 'Wears a stolen cloak.' });
    expect((secondUpdate.effective as { hit_point_average: number }).hit_point_average).toBe(99);
    expect(secondUpdate.notes).toBe('Wears a stolen cloak.');
  });

  // Regression test for the Iteration 3 minor sweep — a stat override could
  // be set but never cleared: updateHomebrewMonsterSchema's fields are
  // deliberately non-nullable (a homebrew monster's OWN row must always
  // have a real AC/HP), so statOverrides itself can never signal "remove
  // this override." clearOverrides is the separate mechanism this test
  // locks in.
  it('clearOverrides removes a previously-set override without touching others set in the same PATCH', async () => {
    const dmList = await listCampaignBestiary(pool, campaignId, 'dm');
    const entryId = dmList.find((e) => e.monster_id === monsterId)!.id;

    await updateCampaignBestiaryEntry(pool, campaignId, entryId, {
      statOverrides: { hitPointAverage: 50, armorClass: 18 },
    });

    const cleared = await updateCampaignBestiaryEntry(pool, campaignId, entryId, {
      statOverrides: { armorClass: 20 },
      clearOverrides: ['hitPointAverage'],
    });

    const effective = cleared.effective as { hit_point_average: number; armor_class: number };
    // hit_point_average falls back to the catalog row's own value (7, per
    // this fixture's setup above) once its override is cleared.
    expect(effective.hit_point_average).toBe(7);
    expect(effective.armor_class).toBe(20);
    expect(Object.keys(cleared.stat_overrides)).not.toContain('hit_point_average');
  });

  it('removing a bestiary entry deletes only the curation row — the catalog monster and any combat instance survive', async () => {
    const instance = await createMonsterInstance(pool, campaignId, {
      monsterId,
      customName: null,
      hpMaxOverride: null,
      armorClassOverride: null,
      hpCurrent: 7,
      hpTemp: 0,
      status: 'alive',
      isRecurring: false,
      notes: null,
    });

    const dmList = await listCampaignBestiary(pool, campaignId, 'dm');
    const entryId = dmList.find((e) => e.monster_id === monsterId)!.id;

    await removeCampaignBestiaryEntry(pool, campaignId, entryId);

    await expect(getCampaignBestiaryEntry(pool, campaignId, entryId, 'dm')).rejects.toMatchObject({ code: 'NOT_FOUND' });

    const monsterStillExists = await pool.query(`SELECT id FROM monsters WHERE id = $1`, [monsterId]);
    expect(monsterStillExists.rowCount).toBe(1);
    const instanceStillExists = await pool.query(`SELECT id FROM monster_instances WHERE id = $1`, [(instance as { id: string }).id]);
    expect(instanceStillExists.rowCount).toBe(1);
  });
});

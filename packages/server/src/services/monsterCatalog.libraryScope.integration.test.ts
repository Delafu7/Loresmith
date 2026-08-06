// Integration tests for Iteration 2 "Shared bestiary across campaigns" —
// the user-library ownership tier, promote/assign scope conversion,
// provenance tracking on fork, the relaxed addToCampaignBestiary check, and
// the delete guard extended to check campaign_bestiary_entries across ALL
// campaigns (not just the owning one). Throwaway campaign/user/monster
// fixtures, same isolation convention as spawn.integration.test.ts.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../db/pool.js';
import {
  assignHomebrewMonsterToCampaign,
  createHomebrewMonster,
  deleteHomebrewMonster,
  duplicateHomebrewMonster,
  promoteHomebrewMonsterToLibrary,
} from './monsterCatalog.js';
import { addToCampaignBestiary } from './campaignBestiary.js';

const ACTION_STAT_BLOCK = [{ name: 'Claw', description: 'Melee attack.' }];
const SPEED = { walk: 30 };

function homebrewInput(name: string) {
  return {
    name,
    size: 'Medium',
    creatureType: 'beast',
    armorClass: 12,
    hitPointAverage: 11,
    hitDice: '2d8+2',
    speed: SPEED,
    str: 12, dex: 12, con: 12, int: 4, wis: 10, cha: 6,
    challengeRating: 0.5,
    xpValue: 100,
    actions: ACTION_STAT_BLOCK,
  };
}

describe('monster library scope (integration, live DB, throwaway fixtures)', () => {
  let dmAId: string;
  let dmBId: string;
  let campaignAId: string;
  let campaignBId: string;

  beforeAll(async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const dmARes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'Library Test DM A', 'x') RETURNING id`,
      [`library-dm-a-${suffix}@example.test`],
    );
    dmAId = dmARes.rows[0]!.id;
    const dmBRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'Library Test DM B', 'x') RETURNING id`,
      [`library-dm-b-${suffix}@example.test`],
    );
    dmBId = dmBRes.rows[0]!.id;

    const campaignARes = await pool.query<{ id: string }>(
      `INSERT INTO campaigns (name, dm_user_id, srd_edition) VALUES ('Library Test Campaign A', $1, '2024') RETURNING id`,
      [dmAId],
    );
    campaignAId = campaignARes.rows[0]!.id;
    await pool.query(`INSERT INTO campaign_members (campaign_id, user_id, role) VALUES ($1, $2, 'dm')`, [campaignAId, dmAId]);

    const campaignBRes = await pool.query<{ id: string }>(
      `INSERT INTO campaigns (name, dm_user_id, srd_edition) VALUES ('Library Test Campaign B', $1, '2024') RETURNING id`,
      [dmAId],
    );
    campaignBId = campaignBRes.rows[0]!.id;
    // dmA runs both campaigns (so "my library, reusable across every
    // campaign I run" is directly testable); dmB is a genuinely different
    // user for the "never leaks another campaign's/user's homebrew" checks.
    await pool.query(`INSERT INTO campaign_members (campaign_id, user_id, role) VALUES ($1, $2, 'dm')`, [campaignBId, dmAId]);
  });

  afterAll(async () => {
    if (campaignAId) await pool.query(`DELETE FROM campaigns WHERE id = $1`, [campaignAId]);
    if (campaignBId) await pool.query(`DELETE FROM campaigns WHERE id = $1`, [campaignBId]);
    // Any surviving user-library monsters (owning_user_id, not
    // campaign-scoped) aren't touched by either campaign's cascade delete —
    // clean up by owner directly, same lesson as spawn.integration.test.ts's
    // own fixture-leak fix.
    await pool.query(`DELETE FROM monsters WHERE owning_user_id = ANY($1::uuid[])`, [[dmAId, dmBId]]);
    await pool.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [[dmAId, dmBId]]);
    await pool.end();
  });

  it('promotes a campaign-owned monster to the user library and back again', async () => {
    const monster = await createHomebrewMonster(pool, campaignAId, dmAId, homebrewInput('Promote Round Trip'));
    expect(monster.owning_campaign_id).toBe(campaignAId);
    expect(monster.owning_user_id).toBeNull();

    const promoted = await promoteHomebrewMonsterToLibrary(pool, campaignAId, dmAId, monster.id as string);
    expect(promoted.owning_campaign_id).toBeNull();
    expect(promoted.owning_user_id).toBe(dmAId);

    const assigned = await assignHomebrewMonsterToCampaign(pool, campaignBId, dmAId, monster.id as string);
    expect(assigned.owning_campaign_id).toBe(campaignBId);
    expect(assigned.owning_user_id).toBeNull();
  });

  it('rejects promoting a monster the campaign does not own', async () => {
    const monster = await createHomebrewMonster(pool, campaignAId, dmAId, homebrewInput('Not This Campaign'));
    await expect(promoteHomebrewMonsterToLibrary(pool, campaignBId, dmAId, monster.id as string)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('rejects assigning a monster the actor does not own in their library', async () => {
    const monster = await createHomebrewMonster(pool, campaignAId, dmAId, homebrewInput('Not My Library'));
    await promoteHomebrewMonsterToLibrary(pool, campaignAId, dmAId, monster.id as string);
    await expect(assignHomebrewMonsterToCampaign(pool, campaignBId, dmBId, monster.id as string)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('addToCampaignBestiary allows the caller\'s own user-library monster and blocks another campaign\'s campaign-scoped homebrew', async () => {
    const libraryMonster = await createHomebrewMonster(pool, campaignAId, dmAId, {
      ...homebrewInput('Shared Library Wolf'),
      libraryScope: 'library',
    });
    expect(libraryMonster.owning_user_id).toBe(dmAId);
    expect(libraryMonster.owning_campaign_id).toBeNull();

    // dmA curates their own library monster into campaign B's bestiary —
    // this is the entire point of the feature.
    const result = await addToCampaignBestiary(pool, campaignBId, dmAId, [libraryMonster.id as string]);
    expect(result.added).toHaveLength(1);

    // A campaign-scoped (not library) homebrew monster stays non-shared: dmB
    // can never add campaign A's own homebrew to any bestiary, even their own.
    const campaignScopedMonster = await createHomebrewMonster(pool, campaignAId, dmAId, homebrewInput('Campaign A Only'));
    await expect(
      addToCampaignBestiary(pool, campaignBId, dmAId, [campaignScopedMonster.id as string]),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('blocks deleting a template that is curated into any campaign\'s bestiary, not just the owning one', async () => {
    const monster = await createHomebrewMonster(pool, campaignAId, dmAId, {
      ...homebrewInput('Delete Guard Test'),
      libraryScope: 'library',
    });
    await addToCampaignBestiary(pool, campaignBId, dmAId, [monster.id as string]);

    await expect(deleteHomebrewMonster(pool, campaignAId, dmAId, monster.id as string)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });

  it('duplicateHomebrewMonster records provenance via derived_from_template_id', async () => {
    const source = await createHomebrewMonster(pool, campaignAId, dmAId, homebrewInput('Fork Source'));
    const fork = await duplicateHomebrewMonster(pool, campaignBId, source.id as string);
    expect(fork.derived_from_template_id).toBe(source.id);
    expect(fork.owning_campaign_id).toBe(campaignBId);
  });
});

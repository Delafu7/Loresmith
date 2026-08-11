// Integration tests for Phase 4 "Bastion tracking" sub-phase 2
// (services/bastions.ts) — covers the "what must be tested" checklist from
// docs/rules/bastions.md §1 that's in scope for this sub-phase (level gate,
// special-facility count enforcement at breakpoints, prerequisite gating +
// dynamic re-evaluation, facility removal leaving bastion_points untouched)
// plus the ownership/enablement gates this sub-phase adds. bastion_turns/
// orders/events (sub-phases 3-4) and combining Bastions are out of scope.
// Throwaway campaign/user/character fixtures, same isolation convention as
// locations.integration.test.ts.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../db/pool.js';
import { AppError } from '../middleware/errors.js';
import { addFacility, createBastion, getBastionWithFacilities, removeFacility } from './bastions.js';

describe('bastions (integration, live DB, throwaway fixtures)', () => {
  let dmUserId: string;
  let playerUserId: string;
  let otherPlayerUserId: string;
  let campaignId: string;
  let wizardClassId: string;
  let lowLevelCharacterId: string; // level 3, always below the Bastion floor
  let mainCharacterId: string; // level 5, bumped to 9 mid-test

  let catalogByKey: Record<string, string>; // index_key -> id

  beforeAll(async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const dmRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'Bastion Test DM', 'x') RETURNING id`,
      [`bastion-dm-${suffix}@example.test`],
    );
    dmUserId = dmRes.rows[0]!.id;

    const playerRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'Bastion Test Player', 'x') RETURNING id`,
      [`bastion-player-${suffix}@example.test`],
    );
    playerUserId = playerRes.rows[0]!.id;

    const otherPlayerRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'Bastion Test Other Player', 'x') RETURNING id`,
      [`bastion-other-player-${suffix}@example.test`],
    );
    otherPlayerUserId = otherPlayerRes.rows[0]!.id;

    const campaignRes = await pool.query<{ id: string }>(
      `INSERT INTO campaigns (name, dm_user_id, srd_edition, bastions_enabled) VALUES ('Bastion Test Campaign', $1, '2024', true) RETURNING id`,
      [dmUserId],
    );
    campaignId = campaignRes.rows[0]!.id;
    await pool.query(`INSERT INTO campaign_members (campaign_id, user_id, role) VALUES ($1, $2, 'dm')`, [campaignId, dmUserId]);
    await pool.query(`INSERT INTO campaign_members (campaign_id, user_id, role) VALUES ($1, $2, 'player')`, [campaignId, playerUserId]);
    await pool.query(
      `INSERT INTO campaign_members (campaign_id, user_id, role) VALUES ($1, $2, 'player')`,
      [campaignId, otherPlayerUserId],
    );

    // Wizard: deliberately a class with no Fighting Style / Unarmored
    // Defense and (for this fresh character) no skill Expertise, so
    // prerequisite failures in the tests below are attributable to the
    // prerequisite check specifically, not incidental level/skill setup.
    const wizardRes = await pool.query<{ id: string }>(
      `SELECT id FROM classes WHERE index_key = 'wizard' AND edition_scope = '2024'`,
    );
    if (wizardRes.rows.length === 0) throw new Error('Expected seeded Wizard class (2024) to exist');
    wizardClassId = wizardRes.rows[0]!.id;

    async function makeCharacter(name: string, level: number): Promise<string> {
      const res = await pool.query<{ id: string }>(
        `INSERT INTO characters
           (campaign_id, is_pc, owner_user_id, created_by_user_id, name, str, dex, con, int, wis, cha,
            armor_class, speed, hp_max, hp_current)
         VALUES ($1, true, $2, $2, $3, 10, 10, 10, 10, 10, 10, 10, 30, 10, 10)
         RETURNING id`,
        [campaignId, playerUserId, name],
      );
      const characterId = res.rows[0]!.id;
      await pool.query(`INSERT INTO character_classes (character_id, class_id, level) VALUES ($1, $2, $3)`, [
        characterId, wizardClassId, level,
      ]);
      return characterId;
    }
    lowLevelCharacterId = await makeCharacter('Bastion Test Low Level', 3);
    mainCharacterId = await makeCharacter('Bastion Test Main', 5);

    const catalogRes = await pool.query<{ index_key: string; id: string }>(`SELECT index_key, id FROM bastion_facility_catalog`);
    catalogByKey = Object.fromEntries(catalogRes.rows.map((r) => [r.index_key, r.id]));
  });

  afterAll(async () => {
    if (campaignId) await pool.query(`DELETE FROM campaigns WHERE id = $1`, [campaignId]);
    if (dmUserId || playerUserId || otherPlayerUserId) {
      await pool.query(`DELETE FROM users WHERE id = ANY($1)`, [[dmUserId, playerUserId, otherPlayerUserId]]);
    }
    await pool.end();
  });

  it('rejects Bastion creation for a character below total level 5, even via a direct service call with no way to spoof level', async () => {
    await expect(
      createBastion(pool, campaignId, 'player', playerUserId, { ownerCharacterId: lowLevelCharacterId }),
    ).rejects.toBeInstanceOf(AppError);
  });

  it('rejects Bastion creation when campaigns.bastions_enabled is false', async () => {
    const disabledCampaignRes = await pool.query<{ id: string }>(
      `INSERT INTO campaigns (name, dm_user_id, srd_edition, bastions_enabled) VALUES ('Bastion Disabled Campaign', $1, '2024', false) RETURNING id`,
      [dmUserId],
    );
    const disabledCampaignId = disabledCampaignRes.rows[0]!.id;
    try {
      await expect(
        createBastion(pool, disabledCampaignId, 'dm', dmUserId, { ownerCharacterId: mainCharacterId }),
      ).rejects.toBeInstanceOf(AppError);
    } finally {
      await pool.query(`DELETE FROM campaigns WHERE id = $1`, [disabledCampaignId]);
    }
  });

  it('rejects Bastion creation by a player who neither owns the character nor is the DM', async () => {
    await expect(
      createBastion(pool, campaignId, 'player', otherPlayerUserId, { ownerCharacterId: mainCharacterId }),
    ).rejects.toBeInstanceOf(AppError);
  });

  let bastionId: string;

  it('lets the owning player create a Bastion for their own level-5+ character', async () => {
    const bastion = await createBastion(pool, campaignId, 'player', playerUserId, { ownerCharacterId: mainCharacterId });
    expect(bastion.owner_character_id).toBe(mainCharacterId);
    expect(bastion.status).toBe('active');
    expect(bastion.bastion_points).toBe(0);
    bastionId = bastion.id;
  });

  it('rejects creating a second active Bastion for the same character (CONFLICT)', async () => {
    await expect(
      createBastion(pool, campaignId, 'player', playerUserId, { ownerCharacterId: mainCharacterId }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('adds a basic facility at any player-chosen size, duplicates allowed', async () => {
    const bedroom1 = await addFacility(pool, campaignId, bastionId, 'player', playerUserId, {
      catalogId: catalogByKey.bastion_bedroom!, space: 'cramped',
    });
    const bedroom2 = await addFacility(pool, campaignId, bastionId, 'player', playerUserId, {
      catalogId: catalogByKey.bastion_bedroom!, space: 'roomy',
    });
    expect(bedroom1.space).toBe('cramped');
    expect(bedroom2.space).toBe('roomy');
  });

  it('rejects a special facility whose prerequisite is not met, then accepts it once the character dynamically qualifies', async () => {
    // Smithy requires Fighting Style or Unarmored Defense -- this character
    // (a fresh Wizard) has neither yet.
    await expect(
      addFacility(pool, campaignId, bastionId, 'player', playerUserId, { catalogId: catalogByKey.bastion_smithy! }),
    ).rejects.toBeInstanceOf(AppError);

    // Simulate the character gaining Fighting Style mid-campaign (e.g. via
    // a feat this app doesn't need to model for this test to be valid --
    // the point is the check re-reads character_classes/class_features
    // live, not a cached flag) by inserting a real class_features row tied
    // to their actual class at or below their actual level.
    await pool.query(
      `INSERT INTO class_features (class_id, level, name, description)
       VALUES ($1, 1, 'Fighting Style', 'Test-only synthetic feature grant.')`,
      [wizardClassId],
    );
    try {
      const smithy = await addFacility(pool, campaignId, bastionId, 'player', playerUserId, {
        catalogId: catalogByKey.bastion_smithy!,
      });
      expect(smithy.catalog_id).toBe(catalogByKey.bastion_smithy);
    } finally {
      await pool.query(`DELETE FROM class_features WHERE class_id = $1 AND name = 'Fighting Style'`, [wizardClassId]);
    }
  });

  it('rejects adding the same special facility twice to the same Bastion', async () => {
    await expect(
      addFacility(pool, campaignId, bastionId, 'player', playerUserId, { catalogId: catalogByKey.bastion_smithy! }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('enforces the special-facility count cap at each level breakpoint, re-checked live against current level', async () => {
    // Already holds Smithy (1 of 2 allowed at level 5). Add one more
    // no-prerequisite level-5 facility to reach the cap of 2.
    await addFacility(pool, campaignId, bastionId, 'player', playerUserId, { catalogId: catalogByKey.bastion_armory! });

    // A 3rd special facility at level 5 must be rejected.
    await expect(
      addFacility(pool, campaignId, bastionId, 'player', playerUserId, { catalogId: catalogByKey.bastion_barracks! }),
    ).rejects.toBeInstanceOf(AppError);

    // Level up to 9 (allowance becomes 4) -- the same request now succeeds,
    // proving the cap is recomputed from current level, not a stored value.
    await pool.query(`UPDATE character_classes SET level = 9 WHERE character_id = $1`, [mainCharacterId]);
    const barracks = await addFacility(pool, campaignId, bastionId, 'player', playerUserId, {
      catalogId: catalogByKey.bastion_barracks!,
    });
    expect(barracks.catalog_id).toBe(catalogByKey.bastion_barracks);
  });

  it('rejects a special facility below the owning character\'s level even after other gates would pass', async () => {
    // War Room requires level 17; this character is level 9.
    await expect(
      addFacility(pool, campaignId, bastionId, 'player', playerUserId, { catalogId: catalogByKey.bastion_war_room! }),
    ).rejects.toBeInstanceOf(AppError);
  });

  it('removing a facility deletes the instance row and leaves bastion_points untouched (the documented level-up-swap behavior)', async () => {
    const before = await getBastionWithFacilities(pool, campaignId, bastionId);
    expect(before.bastion_points).toBe(0);
    const armoryFacility = before.facilities.find((f) => f.catalog_id === catalogByKey.bastion_armory);
    expect(armoryFacility).toBeDefined();

    await removeFacility(pool, campaignId, bastionId, armoryFacility!.id, 'player', playerUserId);

    const after = await getBastionWithFacilities(pool, campaignId, bastionId);
    expect(after.bastion_points).toBe(0); // untouched by the removal
    expect(after.facilities.some((f) => f.id === armoryFacility!.id)).toBe(false);
  });

  it('lets the DM manage any character\'s Bastion regardless of ownership', async () => {
    const bedroom = await addFacility(pool, campaignId, bastionId, 'dm', dmUserId, {
      catalogId: catalogByKey.bastion_kitchen!, space: 'cramped',
    });
    expect(bedroom.catalog_id).toBe(catalogByKey.bastion_kitchen);
  });
});

// Integration test for the nav-point-4 bug fix: getEncounterCombatSnapshot
// (the query FULL_STATE_SYNC/Token.tsx's board rendering is built from) must
// resolve a real image_url when a character has a portrait, and stay null
// (never erroring) when there's nothing to resolve — see Token.tsx's former
// "no image in the payload at all" note. Throwaway campaign/users/character/
// encounter fixtures, same isolation convention as
// encounters.actionEconomyAuthz.integration.test.ts — never touches the
// seeded demo campaign, and never mutates a shared catalog monster row (the
// monster-instance case below relies on the seeded default of no
// art_asset_id/image_url, not on writing to one).

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../db/pool.js';
import { getEncounterCombatSnapshot } from './encounters.js';

describe('getEncounterCombatSnapshot image_url (integration, live DB, throwaway fixtures)', () => {
  let dmUserId: string;
  let campaignId: string;
  let encounterId: string;
  let portraitAssetFileUrl: string;

  beforeAll(async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const dmRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'TokenImage Test DM', 'x') RETURNING id`,
      [`token-image-dm-${suffix}@example.test`],
    );
    dmUserId = dmRes.rows[0]!.id;

    const campaignRes = await pool.query<{ id: string }>(
      `INSERT INTO campaigns (name, dm_user_id, srd_edition) VALUES ('TokenImage Test Campaign', $1, '2024') RETURNING id`,
      [dmUserId],
    );
    campaignId = campaignRes.rows[0]!.id;
    await pool.query(`INSERT INTO campaign_members (campaign_id, user_id, role) VALUES ($1, $2, 'dm')`, [campaignId, dmUserId]);

    const assetRes = await pool.query<{ id: string; file_url: string }>(
      `INSERT INTO campaign_assets (campaign_id, uploaded_by_user_id, asset_type, file_url, mime_type, file_size_bytes)
       VALUES ($1, $2, 'image', '/uploads/campaigns/test/portrait.png', 'image/png', 1024)
       RETURNING id, file_url`,
      [campaignId, dmUserId],
    );
    const portraitAssetId = assetRes.rows[0]!.id;
    portraitAssetFileUrl = assetRes.rows[0]!.file_url;

    const characterWithPortraitRes = await pool.query<{ id: string }>(
      `INSERT INTO characters
         (campaign_id, is_pc, owner_user_id, created_by_user_id, name, str, dex, con, int, wis, cha, armor_class, speed, hp_max, hp_current, portrait_asset_id)
       VALUES ($1, true, $2, $2, 'PC With Portrait', 10, 10, 10, 10, 10, 10, 12, 30, 10, 10, $3)
       RETURNING id`,
      [campaignId, dmUserId, portraitAssetId],
    );
    const characterWithPortraitId = characterWithPortraitRes.rows[0]!.id;

    const characterWithoutPortraitRes = await pool.query<{ id: string }>(
      `INSERT INTO characters
         (campaign_id, is_pc, owner_user_id, created_by_user_id, name, str, dex, con, int, wis, cha, armor_class, speed, hp_max, hp_current)
       VALUES ($1, true, $2, $2, 'PC Without Portrait', 10, 10, 10, 10, 10, 10, 12, 30, 10, 10)
       RETURNING id`,
      [campaignId, dmUserId],
    );
    const characterWithoutPortraitId = characterWithoutPortraitRes.rows[0]!.id;

    // is_unique excluded deliberately: this creates a LIVING instance for the
    // duration of the test, and picking an is_unique monster could spuriously
    // trip another concurrently-running test's system-wide uniqueness check
    // (see createMonsterInstance) — same class of cross-test flake already
    // seen with the seeded "Uniqueness Test Boss" row.
    const monsterCatalogRes = await pool.query<{ id: string }>(
      `SELECT id FROM monsters WHERE art_asset_id IS NULL AND image_url IS NULL AND is_unique = false LIMIT 1`,
    );
    if (!monsterCatalogRes.rows[0]) {
      throw new Error('Expected at least one seeded non-unique monster catalog row with no art for this test');
    }
    const monsterCatalogId = monsterCatalogRes.rows[0].id;
    const monsterInstanceRes = await pool.query<{ id: string }>(
      `INSERT INTO monster_instances (campaign_id, monster_id, hp_current) VALUES ($1, $2, 10) RETURNING id`,
      [campaignId, monsterCatalogId],
    );
    const monsterInstanceId = monsterInstanceRes.rows[0]!.id;

    const encounterRes = await pool.query<{ id: string }>(
      `INSERT INTO encounters (campaign_id, name, status) VALUES ($1, 'TokenImage Test Encounter', 'active') RETURNING id`,
      [campaignId],
    );
    encounterId = encounterRes.rows[0]!.id;

    async function seatParticipant(characterId: string | null, monsterInstanceId: string | null, turnOrder: number): Promise<void> {
      await pool.query(
        `INSERT INTO combat_participants (encounter_id, character_id, monster_instance_id, initiative_roll, turn_order)
         VALUES ($1, $2, $3, 10, $4)`,
        [encounterId, characterId, monsterInstanceId, turnOrder],
      );
    }

    await seatParticipant(characterWithPortraitId, null, 0);
    await seatParticipant(characterWithoutPortraitId, null, 1);
    await seatParticipant(null, monsterInstanceId, 2);
  });

  afterAll(async () => {
    try {
      if (campaignId) await pool.query(`DELETE FROM campaigns WHERE id = $1`, [campaignId]);
    } finally {
      if (dmUserId) await pool.query(`DELETE FROM users WHERE id = $1`, [dmUserId]);
      await pool.end();
    }
  });

  it("resolves a character's uploaded portrait to its file_url", async () => {
    const { participants } = await getEncounterCombatSnapshot(pool, encounterId);
    const p = participants.find((p) => p.name === 'PC With Portrait');
    expect(p).toBeDefined();
    expect(p!.image_url).toBe(portraitAssetFileUrl);
  });

  it('resolves to null (not an error) for a character with no portrait', async () => {
    const { participants } = await getEncounterCombatSnapshot(pool, encounterId);
    const p = participants.find((p) => p.name === 'PC Without Portrait');
    expect(p).toBeDefined();
    expect(p!.image_url).toBeNull();
  });

  it('resolves to null (not an error) for a monster instance with no art_asset_id or image_url', async () => {
    const { participants } = await getEncounterCombatSnapshot(pool, encounterId);
    const p = participants.find((p) => p.monster_instance_id != null);
    expect(p).toBeDefined();
    expect(p!.image_url).toBeNull();
  });
});

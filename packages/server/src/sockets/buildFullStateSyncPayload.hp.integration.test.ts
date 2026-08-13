// Integration test for Phase 2 "restore hp_visibility + banding", exercised
// through buildFullStateSyncPayload end-to-end against a real DB (this
// function is pure poolOrClient-based, no socket.io involved, unlike most of
// broadcast.ts — see that file's own header comments on why the rest of it
// has no harness). Covers the two things resolveHpForViewer's own unit
// test can't: the real SQL join actually carries hp_visibility through
// (services/encounters.ts's getEncounterCombatSnapshot), and the character-
// vs-monster-instance exemption is wired to the real character_id/
// monster_instance_id columns, not just a boolean the unit test hands in by
// hand. Throwaway campaign/users/characters/encounter fixtures, same
// isolation convention as encounters.visibility.integration.test.ts.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../db/pool.js';
import { buildFullStateSyncPayload } from './broadcast.js';
import { setParticipantHpVisibility } from '../services/encounters.js';

describe('buildFullStateSyncPayload HP redaction (integration, live DB, throwaway fixtures)', () => {
  let dmUserId: string;
  let playerUserId: string;
  let campaignId: string;
  let encounterId: string;
  let characterParticipantId: string;
  let monsterParticipantId: string;

  beforeAll(async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const dmRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'HP Visibility Test DM', 'x') RETURNING id`,
      [`hp-vis-dm-${suffix}@example.test`],
    );
    dmUserId = dmRes.rows[0]!.id;

    const playerRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'HP Visibility Test Player', 'x') RETURNING id`,
      [`hp-vis-player-${suffix}@example.test`],
    );
    playerUserId = playerRes.rows[0]!.id;

    const campaignRes = await pool.query<{ id: string }>(
      `INSERT INTO campaigns (name, dm_user_id, srd_edition) VALUES ('HP Visibility Test Campaign', $1, '2024') RETURNING id`,
      [dmUserId],
    );
    campaignId = campaignRes.rows[0]!.id;
    await pool.query(`INSERT INTO campaign_members (campaign_id, user_id, role) VALUES ($1, $2, 'dm')`, [campaignId, dmUserId]);
    await pool.query(`INSERT INTO campaign_members (campaign_id, user_id, role) VALUES ($1, $2, 'player')`, [campaignId, playerUserId]);

    const characterRes = await pool.query<{ id: string }>(
      `INSERT INTO characters
         (campaign_id, is_pc, owner_user_id, created_by_user_id, name, str, dex, con, int, wis, cha, armor_class, speed, hp_max, hp_current)
       VALUES ($1, true, $2, $2, 'HP Visibility Test PC', 10, 10, 10, 10, 10, 10, 12, 30, 40, 12)
       RETURNING id`,
      [campaignId, playerUserId],
    );
    const characterId = characterRes.rows[0]!.id;

    const monsterCatalogRes = await pool.query<{ id: string }>(`SELECT id FROM monsters WHERE is_unique = false LIMIT 1`);
    if (!monsterCatalogRes.rows[0]) throw new Error('Expected at least one seeded non-unique monster catalog row');
    // hp_max_override pins the derived hp_max to a known value (12) —
    // otherwise it'd COALESCE to the seeded monster's own hit_point_average,
    // whatever that happens to be, and this test wants exact/deterministic
    // percentages to assert band names against.
    const monsterInstanceRes = await pool.query<{ id: string }>(
      `INSERT INTO monster_instances (campaign_id, monster_id, hp_current, hp_max_override) VALUES ($1, $2, 12, 12) RETURNING id`,
      [campaignId, monsterCatalogRes.rows[0].id],
    );
    const monsterInstanceId = monsterInstanceRes.rows[0]!.id;

    const encounterRes = await pool.query<{ id: string }>(
      `INSERT INTO encounters (campaign_id, name, status) VALUES ($1, 'HP Visibility Test Encounter', 'active') RETURNING id`,
      [campaignId],
    );
    encounterId = encounterRes.rows[0]!.id;

    const charPartRes = await pool.query<{ id: string }>(
      `INSERT INTO combat_participants (encounter_id, character_id, initiative_roll, turn_order)
       VALUES ($1, $2, 10, 0) RETURNING id`,
      [encounterId, characterId],
    );
    characterParticipantId = charPartRes.rows[0]!.id;

    const monsterPartRes = await pool.query<{ id: string }>(
      `INSERT INTO combat_participants (encounter_id, monster_instance_id, initiative_roll, turn_order)
       VALUES ($1, $2, 5, 1) RETURNING id`,
      [encounterId, monsterInstanceId],
    );
    monsterParticipantId = monsterPartRes.rows[0]!.id;

    // Both participants default to hp_visibility='banded' on insert.
    await setParticipantHpVisibility(pool, encounterId, monsterParticipantId, { hpVisibility: 'hidden' });
  });

  afterAll(async () => {
    try {
      if (campaignId) await pool.query(`DELETE FROM campaigns WHERE id = $1`, [campaignId]);
    } finally {
      if (dmUserId) await pool.query(`DELETE FROM users WHERE id = $1`, [dmUserId]);
      if (playerUserId) await pool.query(`DELETE FROM users WHERE id = $1`, [playerUserId]);
      await pool.end();
    }
  });

  it("the DM's payload always carries exact HP for both participants", async () => {
    const payload = (await buildFullStateSyncPayload(pool, encounterId, campaignId, 'dm', null)) as {
      participants: Array<{ participantId: string; hp: Record<string, unknown> }>;
    };
    const char = payload.participants.find((p) => p.participantId === characterParticipantId)!;
    const monster = payload.participants.find((p) => p.participantId === monsterParticipantId)!;
    expect(char.hp).toMatchObject({ hpVisibility: 'banded', hpCurrent: 12, hpMax: 40 });
    expect(monster.hp).toMatchObject({ hpVisibility: 'hidden', hpCurrent: 12, hpMax: 12 });
  });

  it("a player's payload gives exact HP for the character participant despite its default 'banded' setting", async () => {
    const payload = (await buildFullStateSyncPayload(pool, encounterId, campaignId, 'player', null)) as {
      participants: Array<{ participantId: string; hp: Record<string, unknown> }>;
    };
    const char = payload.participants.find((p) => p.participantId === characterParticipantId)!;
    expect(char.hp).toEqual({ hpVisibility: 'banded', hpCurrent: 12, hpMax: 40, hpTemp: 0 });
  });

  it("a player's payload hides the monster instance's HP entirely when hp_visibility is 'hidden'", async () => {
    const payload = (await buildFullStateSyncPayload(pool, encounterId, campaignId, 'player', null)) as {
      participants: Array<{ participantId: string; hp: Record<string, unknown> }>;
    };
    const monster = payload.participants.find((p) => p.participantId === monsterParticipantId)!;
    expect(monster.hp).toEqual({ hpVisibility: 'hidden' });
  });

  it("a player's payload bands the monster instance's HP when hp_visibility is 'banded'", async () => {
    await setParticipantHpVisibility(pool, encounterId, monsterParticipantId, { hpVisibility: 'banded' });
    const payload = (await buildFullStateSyncPayload(pool, encounterId, campaignId, 'player', null)) as {
      participants: Array<{ participantId: string; hp: Record<string, unknown> }>;
    };
    const monster = payload.participants.find((p) => p.participantId === monsterParticipantId)!;
    expect(monster.hp).toEqual({ hpVisibility: 'banded', band: 'healthy' }); // 12/12 = 100%
  });
});

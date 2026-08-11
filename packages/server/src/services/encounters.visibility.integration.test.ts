// Integration test for encounter visibility by state (nav point 1):
// - a 'preparing' encounter must be invisible to a non-DM in both the list
//   and the direct fetch (404, not 403 — see getEncounter's own comment).
// - a participant with visible_to_players = false must be absent from a
//   non-DM's participant list, present for the DM.
// - setParticipantVisibility actually flips the flag.
// Throwaway campaign/users/characters/encounter fixtures, same isolation
// convention as encounters.actionEconomyAuthz.integration.test.ts — never
// touches the seeded demo campaign.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../db/pool.js';
import { AppError } from '../middleware/errors.js';
import {
  getEncounter,
  getEncounterCombatSnapshot,
  getEncounterFlat,
  listEncounters,
  setParticipantHpVisibility,
  setParticipantVisibility,
  updateEncounter,
} from './encounters.js';

describe('encounter visibility by state (integration, live DB, throwaway fixtures)', () => {
  let dmUserId: string;
  let playerUserId: string;
  let campaignId: string;
  let preparingEncounterId: string;
  let activeEncounterId: string;
  let visibleParticipantId: string;
  let hiddenParticipantId: string;

  beforeAll(async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const dmRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'Visibility Test DM', 'x') RETURNING id`,
      [`visibility-dm-${suffix}@example.test`],
    );
    dmUserId = dmRes.rows[0]!.id;

    const playerRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'Visibility Test Player', 'x') RETURNING id`,
      [`visibility-player-${suffix}@example.test`],
    );
    playerUserId = playerRes.rows[0]!.id;

    const campaignRes = await pool.query<{ id: string }>(
      `INSERT INTO campaigns (name, dm_user_id, srd_edition) VALUES ('Visibility Test Campaign', $1, '2024') RETURNING id`,
      [dmUserId],
    );
    campaignId = campaignRes.rows[0]!.id;
    await pool.query(`INSERT INTO campaign_members (campaign_id, user_id, role) VALUES ($1, $2, 'dm')`, [campaignId, dmUserId]);
    await pool.query(`INSERT INTO campaign_members (campaign_id, user_id, role) VALUES ($1, $2, 'player')`, [campaignId, playerUserId]);

    const characterRes = await pool.query<{ id: string }>(
      `INSERT INTO characters
         (campaign_id, is_pc, owner_user_id, created_by_user_id, name, str, dex, con, int, wis, cha, armor_class, speed, hp_max, hp_current)
       VALUES ($1, true, $2, $2, 'Visibility Test PC', 10, 10, 10, 10, 10, 10, 12, 30, 10, 10)
       RETURNING id`,
      [campaignId, playerUserId],
    );
    const characterId = characterRes.rows[0]!.id;

    // The hidden participant below is a monster instance, not a character —
    // combat_participants has a CHECK requiring exactly one of
    // character_id/monster_instance_id, and "an ambush monster the DM hasn't
    // revealed yet" is the realistic case this flag exists for anyway.
    const monsterCatalogRes = await pool.query<{ id: string }>(`SELECT id FROM monsters WHERE is_unique = false LIMIT 1`);
    if (!monsterCatalogRes.rows[0]) throw new Error('Expected at least one seeded non-unique monster catalog row');
    const monsterInstanceRes = await pool.query<{ id: string }>(
      `INSERT INTO monster_instances (campaign_id, monster_id, hp_current) VALUES ($1, $2, 10) RETURNING id`,
      [campaignId, monsterCatalogRes.rows[0].id],
    );
    const monsterInstanceId = monsterInstanceRes.rows[0]!.id;

    const preparingRes = await pool.query<{ id: string }>(
      `INSERT INTO encounters (campaign_id, name, status) VALUES ($1, 'Preparing Encounter', 'preparing') RETURNING id`,
      [campaignId],
    );
    preparingEncounterId = preparingRes.rows[0]!.id;

    const activeRes = await pool.query<{ id: string }>(
      `INSERT INTO encounters (campaign_id, name, status) VALUES ($1, 'Active Encounter', 'active') RETURNING id`,
      [campaignId],
    );
    activeEncounterId = activeRes.rows[0]!.id;

    const visibleRes = await pool.query<{ id: string }>(
      `INSERT INTO combat_participants (encounter_id, character_id, initiative_roll, turn_order)
       VALUES ($1, $2, 10, 0) RETURNING id`,
      [activeEncounterId, characterId],
    );
    visibleParticipantId = visibleRes.rows[0]!.id;

    const hiddenRes = await pool.query<{ id: string }>(
      `INSERT INTO combat_participants (encounter_id, monster_instance_id, initiative_roll, turn_order, visible_to_players)
       VALUES ($1, $2, 5, 1, false) RETURNING id`,
      [activeEncounterId, monsterInstanceId],
    );
    hiddenParticipantId = hiddenRes.rows[0]!.id;
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

  describe('listEncounters', () => {
    it('DM sees both the preparing and the active encounter', async () => {
      const encounters = await listEncounters(pool, campaignId, 'dm');
      const ids = encounters.map((e) => e.id);
      expect(ids).toContain(preparingEncounterId);
      expect(ids).toContain(activeEncounterId);
    });

    it('a player only sees the active encounter, never the preparing one', async () => {
      const encounters = await listEncounters(pool, campaignId, 'player');
      const ids = encounters.map((e) => e.id);
      expect(ids).not.toContain(preparingEncounterId);
      expect(ids).toContain(activeEncounterId);
    });
  });

  describe('getEncounter', () => {
    it('DM can fetch a preparing encounter directly', async () => {
      const encounter = await getEncounter(pool, campaignId, preparingEncounterId, 'dm');
      expect(encounter.id).toBe(preparingEncounterId);
    });

    it('a player fetching a preparing encounter gets a NOT_FOUND, not a redacted view', async () => {
      await expect(getEncounter(pool, campaignId, preparingEncounterId, 'player')).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });

    it("DM's view of the active encounter includes the hidden participant", async () => {
      const encounter = await getEncounter(pool, campaignId, activeEncounterId, 'dm');
      const ids = encounter.participants.map((p) => p.id);
      expect(ids).toContain(visibleParticipantId);
      expect(ids).toContain(hiddenParticipantId);
    });

    it("a player's view of the active encounter excludes the hidden participant", async () => {
      const encounter = await getEncounter(pool, campaignId, activeEncounterId, 'player');
      const ids = encounter.participants.map((p) => p.id);
      expect(ids).toContain(visibleParticipantId);
      expect(ids).not.toContain(hiddenParticipantId);
    });
  });

  describe('getEncounterFlat', () => {
    it('resolves the caller role itself and applies the same filtering', async () => {
      await expect(getEncounterFlat(pool, playerUserId, preparingEncounterId)).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });

      const asDm = await getEncounterFlat(pool, dmUserId, preparingEncounterId);
      expect(asDm.id).toBe(preparingEncounterId);
      expect(asDm.myRole).toBe('dm');

      const asPlayer = await getEncounterFlat(pool, playerUserId, activeEncounterId);
      expect(asPlayer.participants.map((p) => p.id)).not.toContain(hiddenParticipantId);
    });
  });

  describe('setParticipantVisibility', () => {
    it('flips visible_to_players and is reflected in a subsequent read', async () => {
      const { participant } = await setParticipantVisibility(pool, activeEncounterId, hiddenParticipantId, {
        visible: true,
      });
      expect(participant.visible_to_players).toBe(true);

      const encounter = await getEncounter(pool, campaignId, activeEncounterId, 'player');
      expect(encounter.participants.map((p) => p.id)).toContain(hiddenParticipantId);

      // Restore, so this test is order-independent of the describe blocks above.
      await setParticipantVisibility(pool, activeEncounterId, hiddenParticipantId, { visible: false });
    });

    it('throws NOT_FOUND for a participant id that does not belong to the encounter', async () => {
      await expect(
        setParticipantVisibility(pool, preparingEncounterId, hiddenParticipantId, { visible: true }),
      ).rejects.toBeInstanceOf(AppError);
    });
  });

  describe('setParticipantHpVisibility (Phase 2)', () => {
    it('defaults to banded, and flips to whatever is set, reflected in the combat snapshot', async () => {
      const before = await getEncounterCombatSnapshot(pool, activeEncounterId);
      expect(before.participants.find((p) => p.participant_id === visibleParticipantId)?.hp_visibility).toBe('banded');

      const { participant } = await setParticipantHpVisibility(pool, activeEncounterId, visibleParticipantId, {
        hpVisibility: 'exact',
      });
      expect(participant.hp_visibility).toBe('exact');

      const after = await getEncounterCombatSnapshot(pool, activeEncounterId);
      expect(after.participants.find((p) => p.participant_id === visibleParticipantId)?.hp_visibility).toBe('exact');

      // Restore, so this test is order-independent of the describe blocks above.
      await setParticipantHpVisibility(pool, activeEncounterId, visibleParticipantId, { hpVisibility: 'banded' });
    });

    it('throws NOT_FOUND for a participant id that does not belong to the encounter', async () => {
      await expect(
        setParticipantHpVisibility(pool, preparingEncounterId, visibleParticipantId, { hpVisibility: 'exact' }),
      ).rejects.toBeInstanceOf(AppError);
    });
  });

  // Phase 3 "terrain/complications" fix-while-touching regression: Phase 2's
  // lair_actions column was added to the encounter row but never actually
  // redacted from a non-DM's read — only the round-start broadcast was
  // gated. terrain_notes, added alongside it, is deliberately NOT redacted
  // (visible to every campaign member by design).
  describe('lair_actions redaction / terrain_notes visibility (Phase 2 fix + Phase 3)', () => {
    it('a non-DM never receives lair_actions via getEncounter or listEncounters, but the DM does; terrain_notes reaches both', async () => {
      await updateEncounter(pool, campaignId, activeEncounterId, {
        lairActions: [{ name: 'Tremor', description: 'The cavern shakes.' }],
        terrainNotes: 'Difficult terrain: rubble covers the eastern half of the room.',
      });

      const dmView = await getEncounter(pool, campaignId, activeEncounterId, 'dm');
      expect(dmView.lair_actions).toEqual([{ name: 'Tremor', description: 'The cavern shakes.' }]);
      expect(dmView.terrain_notes).toBe('Difficult terrain: rubble covers the eastern half of the room.');

      const playerView = await getEncounter(pool, campaignId, activeEncounterId, 'player');
      expect(playerView.lair_actions).toBeUndefined();
      expect(playerView.terrain_notes).toBe('Difficult terrain: rubble covers the eastern half of the room.');

      const dmList = await listEncounters(pool, campaignId, 'dm');
      expect(dmList.find((e) => e.id === activeEncounterId)?.lair_actions).toEqual([{ name: 'Tremor', description: 'The cavern shakes.' }]);

      const playerList = await listEncounters(pool, campaignId, 'player');
      expect(playerList.find((e) => e.id === activeEncounterId)?.lair_actions).toBeUndefined();
    });
  });
});

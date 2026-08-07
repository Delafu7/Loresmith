// Regression test for Iteration 3 security major M2 — every per-participant
// broadcast (HP_CHANGED, TOKEN_MOVED, EFFECT_APPLIED/EXPIRED,
// PARTICIPANT_AC_CHANGED, ACTION_ECONOMY_CHANGED, PARTICIPANT_FACTION_CHANGED,
// PARTICIPANT_JOINED, INITIATIVE_ROLLED) used to be a plain room-wide emit
// with no visible_to_players check, unlike buildFullStateSyncPayload/
// broadcastFullStateResync which already filtered correctly. This exercises
// the two lookup helpers those broadcasts now gate on directly against a
// live DB, rather than standing up a full socket.io harness (no existing
// precedent for that in this test suite) — the helpers ARE the security
// decision; the emit-splitting plumbing around them reuses
// splitSocketsByRole, the same helper FULL_STATE_SYNC's role split already
// exercises in production. Throwaway campaign/encounter fixtures, same
// isolation convention as encounters.tokenImage.integration.test.ts.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../db/pool.js';
import { isParticipantIdVisibleToPlayers, isEncounterTargetVisibleToPlayers } from './broadcast.js';

describe('broadcast visibility lookups (integration, live DB, throwaway fixtures)', () => {
  let dmUserId: string;
  let campaignId: string;
  let encounterId: string;
  let visibleCharacterId: string;
  let hiddenCharacterId: string;
  let visibleParticipantId: string;
  let hiddenParticipantId: string;

  beforeAll(async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const dmRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'Broadcast Visibility Test DM', 'x') RETURNING id`,
      [`broadcast-vis-dm-${suffix}@example.test`],
    );
    dmUserId = dmRes.rows[0]!.id;

    const campaignRes = await pool.query<{ id: string }>(
      `INSERT INTO campaigns (name, dm_user_id, srd_edition) VALUES ('Broadcast Visibility Test Campaign', $1, '2024') RETURNING id`,
      [dmUserId],
    );
    campaignId = campaignRes.rows[0]!.id;
    await pool.query(`INSERT INTO campaign_members (campaign_id, user_id, role) VALUES ($1, $2, 'dm')`, [campaignId, dmUserId]);

    async function makeCharacter(name: string): Promise<string> {
      const res = await pool.query<{ id: string }>(
        `INSERT INTO characters
           (campaign_id, is_pc, owner_user_id, created_by_user_id, name, str, dex, con, int, wis, cha, armor_class, speed, hp_max, hp_current)
         VALUES ($1, false, NULL, $2, $3, 10, 10, 10, 10, 10, 10, 12, 30, 10, 10)
         RETURNING id`,
        [campaignId, dmUserId, name],
      );
      return res.rows[0]!.id;
    }
    visibleCharacterId = await makeCharacter('Visible Ambush Target');
    hiddenCharacterId = await makeCharacter('Hidden Ambusher');

    const encounterRes = await pool.query<{ id: string }>(
      `INSERT INTO encounters (campaign_id, name, status) VALUES ($1, 'Broadcast Visibility Test Encounter', 'active') RETURNING id`,
      [campaignId],
    );
    encounterId = encounterRes.rows[0]!.id;

    const visibleRes = await pool.query<{ id: string }>(
      `INSERT INTO combat_participants (encounter_id, character_id, initiative_roll, turn_order, visible_to_players)
       VALUES ($1, $2, 10, 0, true) RETURNING id`,
      [encounterId, visibleCharacterId],
    );
    visibleParticipantId = visibleRes.rows[0]!.id;

    const hiddenRes = await pool.query<{ id: string }>(
      `INSERT INTO combat_participants (encounter_id, character_id, initiative_roll, turn_order, visible_to_players)
       VALUES ($1, $2, 5, 1, false) RETURNING id`,
      [encounterId, hiddenCharacterId],
    );
    hiddenParticipantId = hiddenRes.rows[0]!.id;
  });

  afterAll(async () => {
    if (campaignId) await pool.query(`DELETE FROM campaigns WHERE id = $1`, [campaignId]);
    if (dmUserId) await pool.query(`DELETE FROM users WHERE id = $1`, [dmUserId]);
    await pool.end();
  });

  it('isParticipantIdVisibleToPlayers is true for a visible participant (HP_CHANGED, TOKEN_MOVED, AC, action-economy, faction, joined gate)', async () => {
    expect(await isParticipantIdVisibleToPlayers(pool, visibleParticipantId)).toBe(true);
  });

  it('isParticipantIdVisibleToPlayers is false for a hidden (ambush) participant', async () => {
    expect(await isParticipantIdVisibleToPlayers(pool, hiddenParticipantId)).toBe(false);
  });

  it('isParticipantIdVisibleToPlayers defaults true for a since-removed participant id (never the wrong direction to fail in)', async () => {
    expect(await isParticipantIdVisibleToPlayers(pool, '00000000-0000-0000-0000-000000000000')).toBe(true);
  });

  it('isEncounterTargetVisibleToPlayers (EFFECT_APPLIED/EXPIRED gate) is true for a visible participant\'s character', async () => {
    expect(await isEncounterTargetVisibleToPlayers(pool, encounterId, visibleCharacterId, null)).toBe(true);
  });

  it('isEncounterTargetVisibleToPlayers is false for a hidden participant\'s character — the concrete EFFECT_APPLIED staleness bug', async () => {
    expect(await isEncounterTargetVisibleToPlayers(pool, encounterId, hiddenCharacterId, null)).toBe(false);
  });

  it('isEncounterTargetVisibleToPlayers is true when the target has no seated participant at all (outside-combat effect)', async () => {
    expect(await isEncounterTargetVisibleToPlayers(pool, encounterId, null, null)).toBe(true);
  });
});

// Integration test for authorizeParticipantAction (the authorization gate
// behind PATCH /encounters/:id/participants/:pid/action-economy — see
// routes/encounters.ts's requireOwnParticipantOrDm). This is the one
// combat_participants route a non-DM may call at all, and only for their OWN
// participant, so the boundary worth proving is: a player CAN act on their
// own PC's participant row, CANNOT act on another player's PC, CANNOT act on
// an NPC or a monster-instance participant (both have no owning player), and
// the DM can act on any of them. Throwaway campaign/users/characters/
// encounter/monster-instance fixtures, same isolation convention as
// entityFieldReveal.integration.test.ts — never touches the seeded demo
// campaign or its encounter.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../db/pool.js';
import { authorizeParticipantAction } from './encounters.js';

describe('authorizeParticipantAction (integration, live DB, throwaway fixtures)', () => {
  let dmUserId: number;
  let playerAUserId: number;
  let playerBUserId: number;
  let campaignId: number;
  let encounterId: number;
  let participantAId: number; // owned by playerA
  let participantBId: number; // owned by playerB
  let participantNpcId: number; // NPC character, no owner
  let participantMonsterId: number; // monster instance, no owning character at all

  beforeAll(async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const dmRes = await pool.query<{ id: number }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'ActionEconomy Test DM', 'x') RETURNING id`,
      [`action-economy-authz-dm-${suffix}@example.test`],
    );
    dmUserId = dmRes.rows[0]!.id;

    const playerARes = await pool.query<{ id: number }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'ActionEconomy Test Player A', 'x') RETURNING id`,
      [`action-economy-authz-player-a-${suffix}@example.test`],
    );
    playerAUserId = playerARes.rows[0]!.id;

    const playerBRes = await pool.query<{ id: number }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'ActionEconomy Test Player B', 'x') RETURNING id`,
      [`action-economy-authz-player-b-${suffix}@example.test`],
    );
    playerBUserId = playerBRes.rows[0]!.id;

    const campaignRes = await pool.query<{ id: number }>(
      `INSERT INTO campaigns (name, dm_user_id, srd_edition) VALUES ('ActionEconomy Authz Test Campaign', $1, '2024') RETURNING id`,
      [dmUserId],
    );
    campaignId = campaignRes.rows[0]!.id;

    await pool.query(`INSERT INTO campaign_members (campaign_id, user_id, role) VALUES ($1, $2, 'dm')`, [campaignId, dmUserId]);
    await pool.query(`INSERT INTO campaign_members (campaign_id, user_id, role) VALUES ($1, $2, 'player')`, [campaignId, playerAUserId]);
    await pool.query(`INSERT INTO campaign_members (campaign_id, user_id, role) VALUES ($1, $2, 'player')`, [campaignId, playerBUserId]);

    const charARes = await pool.query<{ id: number }>(
      `INSERT INTO characters
         (campaign_id, is_pc, owner_user_id, created_by_user_id, name, str, dex, con, int, wis, cha, armor_class, speed, hp_max, hp_current)
       VALUES ($1, true, $2, $2, 'PC A', 10, 10, 10, 10, 10, 10, 12, 30, 10, 10)
       RETURNING id`,
      [campaignId, playerAUserId],
    );
    const characterAId = charARes.rows[0]!.id;

    const charBRes = await pool.query<{ id: number }>(
      `INSERT INTO characters
         (campaign_id, is_pc, owner_user_id, created_by_user_id, name, str, dex, con, int, wis, cha, armor_class, speed, hp_max, hp_current)
       VALUES ($1, true, $2, $2, 'PC B', 10, 10, 10, 10, 10, 10, 12, 30, 10, 10)
       RETURNING id`,
      [campaignId, playerBUserId],
    );
    const characterBId = charBRes.rows[0]!.id;

    const npcRes = await pool.query<{ id: number }>(
      `INSERT INTO characters
         (campaign_id, is_pc, owner_user_id, created_by_user_id, name, str, dex, con, int, wis, cha, armor_class, speed, hp_max, hp_current)
       VALUES ($1, false, NULL, $2, 'Ownerless NPC', 10, 10, 10, 10, 10, 10, 12, 30, 10, 10)
       RETURNING id`,
      [campaignId, dmUserId],
    );
    const npcId = npcRes.rows[0]!.id;

    const monsterCatalogRes = await pool.query<{ id: number }>(`SELECT id FROM monsters LIMIT 1`);
    if (!monsterCatalogRes.rows[0]) {
      throw new Error('Expected at least one seeded monster catalog row for this test');
    }
    const monsterCatalogId = monsterCatalogRes.rows[0].id;

    const monsterInstanceRes = await pool.query<{ id: number }>(
      `INSERT INTO monster_instances (campaign_id, monster_id, hp_current) VALUES ($1, $2, 10) RETURNING id`,
      [campaignId, monsterCatalogId],
    );
    const monsterInstanceId = monsterInstanceRes.rows[0]!.id;

    const encounterRes = await pool.query<{ id: number }>(
      `INSERT INTO encounters (campaign_id, name, status) VALUES ($1, 'Authz Test Encounter', 'active') RETURNING id`,
      [campaignId],
    );
    encounterId = encounterRes.rows[0]!.id;

    async function seatParticipant(characterId: number | null, monsterInstanceId: number | null, turnOrder: number): Promise<number> {
      const res = await pool.query<{ id: number }>(
        `INSERT INTO combat_participants (encounter_id, character_id, monster_instance_id, initiative_roll, turn_order)
         VALUES ($1, $2, $3, 10, $4) RETURNING id`,
        [encounterId, characterId, monsterInstanceId, turnOrder],
      );
      return res.rows[0]!.id;
    }

    participantAId = await seatParticipant(characterAId, null, 0);
    participantBId = await seatParticipant(characterBId, null, 1);
    participantNpcId = await seatParticipant(npcId, null, 2);
    participantMonsterId = await seatParticipant(null, monsterInstanceId, 3);
  });

  afterAll(async () => {
    try {
      if (campaignId) await pool.query(`DELETE FROM campaigns WHERE id = $1`, [campaignId]);
    } finally {
      if (dmUserId) await pool.query(`DELETE FROM users WHERE id = $1`, [dmUserId]);
      if (playerAUserId) await pool.query(`DELETE FROM users WHERE id = $1`, [playerAUserId]);
      if (playerBUserId) await pool.query(`DELETE FROM users WHERE id = $1`, [playerBUserId]);
      await pool.end();
    }
  });

  it('a player CAN act on their own participant', async () => {
    await expect(authorizeParticipantAction(pool, playerAUserId, encounterId, participantAId)).resolves.toBe('player');
  });

  it('a player CANNOT act on another player\'s PC participant', async () => {
    await expect(authorizeParticipantAction(pool, playerAUserId, encounterId, participantBId)).rejects.toMatchObject({
      code: 'FORBIDDEN_NOT_OWNER',
    });
  });

  it('a player CANNOT act on an ownerless NPC participant', async () => {
    await expect(authorizeParticipantAction(pool, playerAUserId, encounterId, participantNpcId)).rejects.toMatchObject({
      code: 'FORBIDDEN_NOT_OWNER',
    });
  });

  it('a player CANNOT act on a monster-instance participant', async () => {
    await expect(authorizeParticipantAction(pool, playerAUserId, encounterId, participantMonsterId)).rejects.toMatchObject({
      code: 'FORBIDDEN_NOT_OWNER',
    });
  });

  it('the DM CAN act on any participant — PC, NPC, or monster instance', async () => {
    await expect(authorizeParticipantAction(pool, dmUserId, encounterId, participantAId)).resolves.toBe('dm');
    await expect(authorizeParticipantAction(pool, dmUserId, encounterId, participantBId)).resolves.toBe('dm');
    await expect(authorizeParticipantAction(pool, dmUserId, encounterId, participantNpcId)).resolves.toBe('dm');
    await expect(authorizeParticipantAction(pool, dmUserId, encounterId, participantMonsterId)).resolves.toBe('dm');
  });

  it('a non-member of the campaign is rejected before ownership is even considered', async () => {
    const outsiderRes = await pool.query<{ id: number }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'Outsider', 'x') RETURNING id`,
      [`action-economy-authz-outsider-${Date.now()}@example.test`],
    );
    const outsiderId = outsiderRes.rows[0]!.id;
    try {
      await expect(authorizeParticipantAction(pool, outsiderId, encounterId, participantAId)).rejects.toMatchObject({
        code: 'NOT_CAMPAIGN_MEMBER',
      });
    } finally {
      await pool.query(`DELETE FROM users WHERE id = $1`, [outsiderId]);
    }
  });

  it('404s for a participant id that does not belong to the given encounter', async () => {
    await expect(authorizeParticipantAction(pool, dmUserId, encounterId, -1)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

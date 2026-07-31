// Integration test for action recording + combat log (nav point 2):
// - recordAction resolves actor/target names and means correctly, supports
//   multiple targets, and enforces the same DM-or-owning-player authorization
//   as action-economy spends.
// - listActionsForEncounter respects encounter visibility (nav point 1) — an
//   action touching a currently-hidden participant is excluded for a player,
//   present for the DM.
// - isActionVisibleToPlayers (used by the ACTION_RECORDED broadcast) agrees
//   with that same filtering for a single action.
// Throwaway campaign/users/characters/encounter fixtures, same isolation
// convention as encounters.actionEconomyAuthz.integration.test.ts.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../db/pool.js';
import { AppError } from '../middleware/errors.js';
import { isActionVisibleToPlayers, listActionsForEncounter, recordAction } from './combatActions.js';

describe('action recording + combat log (integration, live DB, throwaway fixtures)', () => {
  let dmUserId: string;
  let playerAUserId: string;
  let playerBUserId: string;
  let campaignId: string;
  let encounterId: string;
  let participantAId: string; // owned by playerA
  let participantBId: string; // owned by playerB
  let visibleMonsterParticipantId: string;
  let hiddenMonsterParticipantId: string;

  beforeAll(async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    async function makeUser(label: string): Promise<string> {
      const res = await pool.query<{ id: string }>(
        `INSERT INTO users (email, display_name, password_hash) VALUES ($1, $2, 'x') RETURNING id`,
        [`combat-actions-${label}-${suffix}@example.test`, `CombatActions Test ${label}`],
      );
      return res.rows[0]!.id;
    }
    dmUserId = await makeUser('dm');
    playerAUserId = await makeUser('player-a');
    playerBUserId = await makeUser('player-b');

    const campaignRes = await pool.query<{ id: string }>(
      `INSERT INTO campaigns (name, dm_user_id, srd_edition) VALUES ('CombatActions Test Campaign', $1, '2024') RETURNING id`,
      [dmUserId],
    );
    campaignId = campaignRes.rows[0]!.id;
    await pool.query(`INSERT INTO campaign_members (campaign_id, user_id, role) VALUES ($1, $2, 'dm')`, [campaignId, dmUserId]);
    await pool.query(`INSERT INTO campaign_members (campaign_id, user_id, role) VALUES ($1, $2, 'player')`, [campaignId, playerAUserId]);
    await pool.query(`INSERT INTO campaign_members (campaign_id, user_id, role) VALUES ($1, $2, 'player')`, [campaignId, playerBUserId]);

    async function makeCharacter(name: string, ownerUserId: string): Promise<string> {
      const res = await pool.query<{ id: string }>(
        `INSERT INTO characters
           (campaign_id, is_pc, owner_user_id, created_by_user_id, name, str, dex, con, int, wis, cha, armor_class, speed, hp_max, hp_current)
         VALUES ($1, true, $2, $2, $3, 10, 10, 10, 10, 10, 10, 12, 30, 10, 10)
         RETURNING id`,
        [campaignId, ownerUserId, name],
      );
      return res.rows[0]!.id;
    }
    const characterAId = await makeCharacter('CombatActions PC A', playerAUserId);
    const characterBId = await makeCharacter('CombatActions PC B', playerBUserId);

    const monsterCatalogRes = await pool.query<{ id: string }>(`SELECT id FROM monsters WHERE is_unique = false LIMIT 2`);
    if (monsterCatalogRes.rows.length < 1) throw new Error('Expected at least one seeded non-unique monster catalog row');
    const monsterId = monsterCatalogRes.rows[0]!.id;

    async function makeMonsterInstance(): Promise<string> {
      const res = await pool.query<{ id: string }>(
        `INSERT INTO monster_instances (campaign_id, monster_id, hp_current) VALUES ($1, $2, 10) RETURNING id`,
        [campaignId, monsterId],
      );
      return res.rows[0]!.id;
    }
    const visibleMonsterInstanceId = await makeMonsterInstance();
    const hiddenMonsterInstanceId = await makeMonsterInstance();

    const encounterRes = await pool.query<{ id: string }>(
      `INSERT INTO encounters (campaign_id, name, status) VALUES ($1, 'CombatActions Test Encounter', 'active') RETURNING id`,
      [campaignId],
    );
    encounterId = encounterRes.rows[0]!.id;

    async function seatParticipant(
      characterId: string | null,
      monsterInstanceId: string | null,
      turnOrder: number,
      visible = true,
    ): Promise<string> {
      const res = await pool.query<{ id: string }>(
        `INSERT INTO combat_participants (encounter_id, character_id, monster_instance_id, initiative_roll, turn_order, visible_to_players)
         VALUES ($1, $2, $3, 10, $4, $5) RETURNING id`,
        [encounterId, characterId, monsterInstanceId, turnOrder, visible],
      );
      return res.rows[0]!.id;
    }
    participantAId = await seatParticipant(characterAId, null, 0);
    participantBId = await seatParticipant(characterBId, null, 1);
    visibleMonsterParticipantId = await seatParticipant(null, visibleMonsterInstanceId, 2, true);
    hiddenMonsterParticipantId = await seatParticipant(null, hiddenMonsterInstanceId, 3, false);
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

  it('records a single-target action and resolves actor/target/means display names', async () => {
    const action = await recordAction(pool, playerAUserId, encounterId, {
      actorParticipantId: participantAId,
      targetParticipantIds: [visibleMonsterParticipantId],
      actionType: 'melee_attack',
      meansLabel: 'Shortlongsword',
      resultKind: 'hit',
      damageAmount: 6,
    });

    expect(action.actorName).toBe('CombatActions PC A');
    expect(action.meansName).toBe('Shortlongsword');
    expect(action.resultKind).toBe('hit');
    expect(action.damageAmount).toBe(6);
    expect(action.targets).toHaveLength(1);
    expect(action.targets[0]!.monsterInstanceId).not.toBeNull();
  });

  it('records a multi-target action (e.g. a spell hitting several creatures)', async () => {
    const action = await recordAction(pool, dmUserId, encounterId, {
      actorParticipantId: visibleMonsterParticipantId,
      targetParticipantIds: [participantAId, participantBId],
      actionType: 'spell',
      meansLabel: 'Fireball',
      resultKind: 'save_fail',
      damageAmount: 28,
    });
    expect(action.targets).toHaveLength(2);
    const targetNames = action.targets.map((t) => t.name).sort();
    expect(targetNames).toEqual(['CombatActions PC A', 'CombatActions PC B'].sort());
  });

  it('a player CAN record an action for their own character', async () => {
    await expect(
      recordAction(pool, playerAUserId, encounterId, {
        actorParticipantId: participantAId,
        targetParticipantIds: [],
        actionType: 'movement',
      }),
    ).resolves.toMatchObject({ actionType: 'movement' });
  });

  it("a player CANNOT record an action for another player's character", async () => {
    await expect(
      recordAction(pool, playerAUserId, encounterId, {
        actorParticipantId: participantBId,
        targetParticipantIds: [],
        actionType: 'other',
      }),
    ).rejects.toBeInstanceOf(AppError);
  });

  it('rejects a target participant that is not seated in this encounter', async () => {
    await expect(
      recordAction(pool, dmUserId, encounterId, {
        actorParticipantId: participantAId,
        targetParticipantIds: ['00000000-0000-0000-0000-000000000000'],
        actionType: 'other',
      }),
    ).rejects.toBeInstanceOf(AppError);
  });

  describe('visibility filtering', () => {
    it("an action targeting the hidden monster is invisible to a player, visible to the DM", async () => {
      const action = await recordAction(pool, dmUserId, encounterId, {
        actorParticipantId: participantAId,
        targetParticipantIds: [hiddenMonsterParticipantId],
        actionType: 'melee_attack',
        meansLabel: 'Sneak attack on the hidden ambusher',
        resultKind: 'hit',
      });

      const visibleToPlayers = await isActionVisibleToPlayers(pool, encounterId, action);
      expect(visibleToPlayers).toBe(false);

      const asDm = await listActionsForEncounter(pool, encounterId, 'dm', { limit: 100, offset: 0 });
      expect(asDm.map((a) => a.id)).toContain(action.id);

      const asPlayer = await listActionsForEncounter(pool, encounterId, 'player', { limit: 100, offset: 0 });
      expect(asPlayer.map((a) => a.id)).not.toContain(action.id);
    });

    it('an action between two visible participants is visible to both roles', async () => {
      const action = await recordAction(pool, dmUserId, encounterId, {
        actorParticipantId: visibleMonsterParticipantId,
        targetParticipantIds: [participantAId],
        actionType: 'melee_attack',
        resultKind: 'miss',
      });

      const asDm = await listActionsForEncounter(pool, encounterId, 'dm', { limit: 100, offset: 0 });
      const asPlayer = await listActionsForEncounter(pool, encounterId, 'player', { limit: 100, offset: 0 });
      expect(asDm.map((a) => a.id)).toContain(action.id);
      expect(asPlayer.map((a) => a.id)).toContain(action.id);
    });
  });
});

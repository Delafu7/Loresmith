// Integration test for services/pendingActions.ts's listPendingActions
// scoping — the one Phase 4 behavior not already exercised by
// monsters.playerAttackAuthz.integration.test.ts's queue/approve/reject
// coverage: the DM sees every request in the encounter, but a player sees
// only their OWN, never another player's in-flight or resolved request.
// Same throwaway-fixtures isolation convention as that file.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../db/pool.js';
import { addParticipant, createEncounter } from './encounters.js';
import { applyMonsterInstanceDamage } from './monsters.js';
import { listPendingActions } from './pendingActions.js';

describe('listPendingActions scoping (integration, live DB, throwaway fixtures)', () => {
  let dmUserId: string;
  let playerAUserId: string;
  let playerBUserId: string;
  let campaignId: string;
  let encounterId: string;
  let participantAId: string;
  let participantBId: string;
  let monsterInstanceId: string;

  beforeAll(async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const dmRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'PendingListScope Test DM', 'x') RETURNING id`,
      [`pending-list-scope-dm-${suffix}@example.test`],
    );
    dmUserId = dmRes.rows[0]!.id;
    const playerARes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'PendingListScope Test Player A', 'x') RETURNING id`,
      [`pending-list-scope-player-a-${suffix}@example.test`],
    );
    playerAUserId = playerARes.rows[0]!.id;
    const playerBRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'PendingListScope Test Player B', 'x') RETURNING id`,
      [`pending-list-scope-player-b-${suffix}@example.test`],
    );
    playerBUserId = playerBRes.rows[0]!.id;

    const campaignRes = await pool.query<{ id: string }>(
      `INSERT INTO campaigns (name, dm_user_id, srd_edition) VALUES ('PendingListScope Test Campaign', $1, '2024') RETURNING id`,
      [dmUserId],
    );
    campaignId = campaignRes.rows[0]!.id;
    await pool.query(`INSERT INTO campaign_members (campaign_id, user_id, role) VALUES ($1, $2, 'dm')`, [campaignId, dmUserId]);
    await pool.query(`INSERT INTO campaign_members (campaign_id, user_id, role) VALUES ($1, $2, 'player')`, [campaignId, playerAUserId]);
    await pool.query(`INSERT INTO campaign_members (campaign_id, user_id, role) VALUES ($1, $2, 'player')`, [campaignId, playerBUserId]);

    const charARes = await pool.query<{ id: string }>(
      `INSERT INTO characters
         (campaign_id, is_pc, owner_user_id, created_by_user_id, name, str, dex, con, int, wis, cha, armor_class, speed, hp_max, hp_current)
       VALUES ($1, true, $2, $2, 'PendingListScope PC A', 14, 10, 10, 10, 10, 10, 12, 30, 10, 10)
       RETURNING id`,
      [campaignId, playerAUserId],
    );
    const characterAId = charARes.rows[0]!.id;
    const charBRes = await pool.query<{ id: string }>(
      `INSERT INTO characters
         (campaign_id, is_pc, owner_user_id, created_by_user_id, name, str, dex, con, int, wis, cha, armor_class, speed, hp_max, hp_current)
       VALUES ($1, true, $2, $2, 'PendingListScope PC B', 14, 10, 10, 10, 10, 10, 12, 30, 10, 10)
       RETURNING id`,
      [campaignId, playerBUserId],
    );
    const characterBId = charBRes.rows[0]!.id;

    const monsterCatalogRes = await pool.query<{ id: string }>(`SELECT id FROM monsters LIMIT 1`);
    if (!monsterCatalogRes.rows[0]) throw new Error('Expected at least one seeded monster catalog row for this test');
    const monsterInstanceRes = await pool.query<{ id: string }>(
      `INSERT INTO monster_instances (campaign_id, monster_id, hp_current) VALUES ($1, $2, 50) RETURNING id`,
      [campaignId, monsterCatalogRes.rows[0].id],
    );
    monsterInstanceId = monsterInstanceRes.rows[0]!.id;
    await pool.query(`INSERT INTO campaign_bestiary_entries (campaign_id, monster_id) VALUES ($1, $2)`, [
      campaignId,
      monsterCatalogRes.rows[0].id,
    ]);

    const encounter = await createEncounter(pool, campaignId, { name: 'PendingListScope Test Encounter' });
    encounterId = encounter.id;

    // Both PCs share turn_order 0 is impossible (unique per participant), so
    // instead both attacks are submitted while it's PC A's turn — PC A's
    // request comes from a legitimate on-turn attack; PC B's is queued via
    // the DM directly bypassing the turn check (role='dm' skips it) so this
    // fixture doesn't need a second turn-advance round trip just to get a
    // second pending row to test list-scoping against.
    const { participant: participantA } = await addParticipant(pool, encounterId, { characterId: characterAId });
    participantAId = participantA.id; // turn_order 0
    const { participant: participantB } = await addParticipant(pool, encounterId, { characterId: characterBId });
    participantBId = participantB.id; // turn_order 1
    await addParticipant(pool, encounterId, { monsterInstanceId });

    await pool.query(`UPDATE encounters SET status = 'active', current_turn_index = 0 WHERE id = $1`, [encounterId]);
  });

  afterAll(async () => {
    if (campaignId) await pool.query(`DELETE FROM campaigns WHERE id = $1`, [campaignId]);
    if (dmUserId) await pool.query(`DELETE FROM users WHERE id = $1`, [dmUserId]);
    if (playerAUserId) await pool.query(`DELETE FROM users WHERE id = $1`, [playerAUserId]);
    if (playerBUserId) await pool.query(`DELETE FROM users WHERE id = $1`, [playerBUserId]);
    await pool.end();
  });

  const dmg = { diceSides: 6 as const, diceCount: 1, modifier: 0, damageType: null, isCritical: false };

  it('DM sees every pending request; each player sees only their own', async () => {
    const queuedA = await applyMonsterInstanceDamage(pool, playerAUserId, monsterInstanceId, {
      ...dmg,
      encounterId,
      attackerParticipantId: participantAId,
    });
    if (!('pending' in queuedA)) throw new Error('Expected a pending request for player A');

    // Advance the turn to B so B's submission also passes the turn check.
    await pool.query(`UPDATE encounters SET current_turn_index = 1 WHERE id = $1`, [encounterId]);
    const queuedB = await applyMonsterInstanceDamage(pool, playerBUserId, monsterInstanceId, {
      ...dmg,
      encounterId,
      attackerParticipantId: participantBId,
    });
    if (!('pending' in queuedB)) throw new Error('Expected a pending request for player B');

    const dmView = await listPendingActions(pool, dmUserId, encounterId);
    expect(dmView.map((r) => r.id).sort()).toEqual([queuedA.request.id, queuedB.request.id].sort());

    const playerAView = await listPendingActions(pool, playerAUserId, encounterId);
    expect(playerAView.map((r) => r.id)).toEqual([queuedA.request.id]);

    const playerBView = await listPendingActions(pool, playerBUserId, encounterId);
    expect(playerBView.map((r) => r.id)).toEqual([queuedB.request.id]);
  });
});

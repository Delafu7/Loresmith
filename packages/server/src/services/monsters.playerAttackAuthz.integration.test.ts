// Integration test for Phase 1 "players attack from their own UI" —
// authorizePlayerAttack as wired into applyMonsterInstanceDamage
// (services/monsters.ts). Confirms the things the feature promised: a
// player can attack a monster instance on their own turn (Phase 4: which
// now means the attack is QUEUED for DM approval, not resolved immediately
// — see the 'queues a pending request' test below), a player is rejected
// off-turn, and a crafted request naming a participant the actor doesn't
// control is rejected — same throwaway-fixtures isolation convention as
// shove.turnOrderAuthz.integration.test.ts and damageAuthz.integration.test.ts
// (which already covers the "no attackerParticipantId at all" DM-only
// fallback, not repeated here).

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../db/pool.js';
import { addParticipant, createEncounter } from './encounters.js';
import { applyMonsterInstanceDamage } from './monsters.js';
import * as pendingActionsService from './pendingActions.js';

describe('applyMonsterInstanceDamage player-attack authorization (integration, live DB, throwaway fixtures)', () => {
  let dmUserId: string;
  let playerAUserId: string;
  let playerBUserId: string;
  let campaignId: string;
  let encounterId: string;
  let activeParticipantId: string; // playerA's PC, turn_order 0
  let waitingParticipantId: string; // playerB's PC, turn_order 1
  let monsterInstanceId: string;
  let targetParticipantId: string;

  beforeAll(async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const dmRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'PlayerAttackAuthz Test DM', 'x') RETURNING id`,
      [`player-attack-authz-dm-${suffix}@example.test`],
    );
    dmUserId = dmRes.rows[0]!.id;

    const playerARes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'PlayerAttackAuthz Test Player A', 'x') RETURNING id`,
      [`player-attack-authz-player-a-${suffix}@example.test`],
    );
    playerAUserId = playerARes.rows[0]!.id;

    const playerBRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'PlayerAttackAuthz Test Player B', 'x') RETURNING id`,
      [`player-attack-authz-player-b-${suffix}@example.test`],
    );
    playerBUserId = playerBRes.rows[0]!.id;

    const campaignRes = await pool.query<{ id: string }>(
      `INSERT INTO campaigns (name, dm_user_id, srd_edition) VALUES ('PlayerAttackAuthz Test Campaign', $1, '2024') RETURNING id`,
      [dmUserId],
    );
    campaignId = campaignRes.rows[0]!.id;
    await pool.query(`INSERT INTO campaign_members (campaign_id, user_id, role) VALUES ($1, $2, 'dm')`, [campaignId, dmUserId]);
    await pool.query(`INSERT INTO campaign_members (campaign_id, user_id, role) VALUES ($1, $2, 'player')`, [campaignId, playerAUserId]);
    await pool.query(`INSERT INTO campaign_members (campaign_id, user_id, role) VALUES ($1, $2, 'player')`, [campaignId, playerBUserId]);

    const charARes = await pool.query<{ id: string }>(
      `INSERT INTO characters
         (campaign_id, is_pc, owner_user_id, created_by_user_id, name, str, dex, con, int, wis, cha, armor_class, speed, hp_max, hp_current)
       VALUES ($1, true, $2, $2, 'PlayerAttackAuthz PC A', 14, 10, 10, 10, 10, 10, 12, 30, 10, 10)
       RETURNING id`,
      [campaignId, playerAUserId],
    );
    const characterAId = charARes.rows[0]!.id;

    const charBRes = await pool.query<{ id: string }>(
      `INSERT INTO characters
         (campaign_id, is_pc, owner_user_id, created_by_user_id, name, str, dex, con, int, wis, cha, armor_class, speed, hp_max, hp_current)
       VALUES ($1, true, $2, $2, 'PlayerAttackAuthz PC B', 14, 10, 10, 10, 10, 10, 12, 30, 10, 10)
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

    // addParticipant requires campaign-bestiary curation — see
    // assertMonsterCuratedInBestiary (services/campaignBestiary.ts).
    await pool.query(`INSERT INTO campaign_bestiary_entries (campaign_id, monster_id) VALUES ($1, $2)`, [
      campaignId,
      monsterCatalogRes.rows[0].id,
    ]);

    const encounter = await createEncounter(pool, campaignId, { name: 'PlayerAttackAuthz Test Encounter' });
    encounterId = encounter.id;

    const { participant: participantA } = await addParticipant(pool, encounterId, { characterId: characterAId });
    activeParticipantId = participantA.id; // turn_order 0
    const { participant: participantB } = await addParticipant(pool, encounterId, { characterId: characterBId });
    waitingParticipantId = participantB.id; // turn_order 1
    const { participant: targetParticipant } = await addParticipant(pool, encounterId, { monsterInstanceId });
    targetParticipantId = targetParticipant.id;
    void targetParticipantId;

    await pool.query(`UPDATE encounters SET status = 'active', current_turn_index = 0 WHERE id = $1`, [encounterId]);
  });

  afterAll(async () => {
    if (campaignId) await pool.query(`DELETE FROM campaigns WHERE id = $1`, [campaignId]);
    if (dmUserId) await pool.query(`DELETE FROM users WHERE id = $1`, [dmUserId]);
    if (playerAUserId) await pool.query(`DELETE FROM users WHERE id = $1`, [playerAUserId]);
    if (playerBUserId) await pool.query(`DELETE FROM users WHERE id = $1`, [playerBUserId]);
    await pool.end();
  });

  const dmg = { diceSides: 6 as const, diceCount: 1, modifier: 0, damageType: null, isCritical: false, encounterId: undefined as string | undefined };

  it('the controlling player attacking on their own turn queues a pending request, not an immediate resolution (Phase 4)', async () => {
    const result = await applyMonsterInstanceDamage(pool, playerAUserId, monsterInstanceId, {
      ...dmg,
      encounterId,
      attackerParticipantId: activeParticipantId,
    });
    expect(result).toMatchObject({
      pending: true,
      request: {
        status: 'pending',
        kind: 'attack_monster',
        requested_by_user_id: playerAUserId,
        actor_participant_id: activeParticipantId,
        target_participant_ids: [targetParticipantId],
      },
    });
  });

  it('DM approval replays the exact queued payload and actually resolves the damage', async () => {
    const queued = await applyMonsterInstanceDamage(pool, playerAUserId, monsterInstanceId, {
      ...dmg,
      encounterId,
      attackerParticipantId: activeParticipantId,
    });
    if (!('pending' in queued)) throw new Error('Expected a pending request');

    const resolvable = await pendingActionsService.fetchPendingForResolution(pool, dmUserId, queued.request.id);
    expect(resolvable.status).toBe('pending');

    const { instanceId, damage } = resolvable.payload as { instanceId: string; damage: typeof dmg };
    const resolved = await applyMonsterInstanceDamage(pool, dmUserId, instanceId, damage);
    if ('pending' in resolved) throw new Error('DM approval unexpectedly produced another pending request');
    expect(resolved.appliedDamage).toEqual(expect.any(Number));

    const approved = await pendingActionsService.markPendingApproved(pool, dmUserId, queued.request.id, resolved);
    expect(approved.status).toBe('approved');
    expect(approved.resolved_by_user_id).toBe(dmUserId);
    expect(approved.result).toMatchObject({ appliedDamage: resolved.appliedDamage });
  });

  it('DM rejection discards the request without applying anything', async () => {
    const queued = await applyMonsterInstanceDamage(pool, playerAUserId, monsterInstanceId, {
      ...dmg,
      encounterId,
      attackerParticipantId: activeParticipantId,
    });
    if (!('pending' in queued)) throw new Error('Expected a pending request');

    const rejected = await pendingActionsService.markPendingRejected(pool, dmUserId, queued.request.id);
    expect(rejected.status).toBe('rejected');
    expect(rejected.resolved_by_user_id).toBe(dmUserId);

    // A rejected request can't be approved afterward.
    await expect(pendingActionsService.fetchPendingForResolution(pool, dmUserId, queued.request.id)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });

  it('a non-DM cannot approve or reject a pending request', async () => {
    const queued = await applyMonsterInstanceDamage(pool, playerAUserId, monsterInstanceId, {
      ...dmg,
      encounterId,
      attackerParticipantId: activeParticipantId,
    });
    if (!('pending' in queued)) throw new Error('Expected a pending request');

    await expect(pendingActionsService.fetchPendingForResolution(pool, playerBUserId, queued.request.id)).rejects.toMatchObject({
      code: 'FORBIDDEN_ROLE',
    });
  });

  it('rejects an attack submitted by a player whose participant is not currently up', async () => {
    await expect(
      applyMonsterInstanceDamage(pool, playerBUserId, monsterInstanceId, {
        ...dmg,
        encounterId,
        attackerParticipantId: waitingParticipantId,
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT', details: { reason: 'NOT_YOUR_TURN' } });
  });

  it('rejects a crafted request where the actor names a participant they do not control', async () => {
    // playerA is on-turn, but attempts to attack "as" playerB's participant —
    // must be rejected regardless of whose turn it is.
    await expect(
      applyMonsterInstanceDamage(pool, playerAUserId, monsterInstanceId, {
        ...dmg,
        encounterId,
        attackerParticipantId: waitingParticipantId,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN_NOT_OWNER' });
  });

  it('rejects when attackerParticipantId is provided without an encounterId', async () => {
    await expect(
      applyMonsterInstanceDamage(pool, playerAUserId, monsterInstanceId, {
        ...dmg,
        encounterId: undefined,
        attackerParticipantId: activeParticipantId,
      }),
    ).rejects.toThrow();
  });
});

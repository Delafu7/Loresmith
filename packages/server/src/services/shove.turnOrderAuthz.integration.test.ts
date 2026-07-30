// Integration test for requireCurrentTurn as wired into performShove.
// Shove is deliberately scoped to a PC attacker vs. an NPC (monster
// instance) defender and is DM-gated at the route layer (routes/encounters.ts
// requireEncounterDm) — but nothing previously stopped the DM from invoking
// it on behalf of a participant whose turn hasn't come up yet. Throwaway
// campaign/encounter fixtures, same isolation convention as
// encounters.turnOrderAuthz.integration.test.ts.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../db/pool.js';
import { addParticipant, createEncounter } from './encounters.js';
import { performShove } from './shove.js';

describe('performShove turn-order enforcement (integration, live DB, throwaway fixtures)', () => {
  let dmUserId: string;
  let campaignId: string;
  let encounterId: string;
  let activeParticipantId: string; // PC, turn_order 0
  let waitingParticipantId: string; // PC, turn_order 1
  let targetParticipantId: string; // NPC (monster instance)

  beforeAll(async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const dmRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'ShoveTurnOrder Test DM', 'x') RETURNING id`,
      [`shove-turn-order-dm-${suffix}@example.test`],
    );
    dmUserId = dmRes.rows[0]!.id;

    const campaignRes = await pool.query<{ id: string }>(
      `INSERT INTO campaigns (name, dm_user_id, srd_edition) VALUES ('ShoveTurnOrder Test Campaign', $1, '2024') RETURNING id`,
      [dmUserId],
    );
    campaignId = campaignRes.rows[0]!.id;

    const charARes = await pool.query<{ id: string }>(
      `INSERT INTO characters
         (campaign_id, is_pc, owner_user_id, created_by_user_id, name, str, dex, con, int, wis, cha, armor_class, speed, hp_max, hp_current)
       VALUES ($1, true, $2, $2, 'ShoveTurnOrder PC A', 14, 10, 10, 10, 10, 10, 12, 30, 10, 10)
       RETURNING id`,
      [campaignId, dmUserId],
    );
    const characterAId = charARes.rows[0]!.id;

    const charBRes = await pool.query<{ id: string }>(
      `INSERT INTO characters
         (campaign_id, is_pc, owner_user_id, created_by_user_id, name, str, dex, con, int, wis, cha, armor_class, speed, hp_max, hp_current)
       VALUES ($1, true, $2, $2, 'ShoveTurnOrder PC B', 14, 10, 10, 10, 10, 10, 12, 30, 10, 10)
       RETURNING id`,
      [campaignId, dmUserId],
    );
    const characterBId = charBRes.rows[0]!.id;

    const monsterCatalogRes = await pool.query<{ id: string }>(`SELECT id FROM monsters LIMIT 1`);
    if (!monsterCatalogRes.rows[0]) {
      throw new Error('Expected at least one seeded monster catalog row for this test');
    }
    const monsterInstanceRes = await pool.query<{ id: string }>(
      `INSERT INTO monster_instances (campaign_id, monster_id, hp_current) VALUES ($1, $2, 10) RETURNING id`,
      [campaignId, monsterCatalogRes.rows[0].id],
    );
    const monsterInstanceId = monsterInstanceRes.rows[0]!.id;

    const encounter = await createEncounter(pool, campaignId, { name: 'ShoveTurnOrder Test Encounter' });
    encounterId = encounter.id;

    const { participant: participantA } = await addParticipant(pool, encounterId, { characterId: characterAId });
    activeParticipantId = participantA.id; // turn_order 0
    const { participant: participantB } = await addParticipant(pool, encounterId, { characterId: characterBId });
    waitingParticipantId = participantB.id; // turn_order 1
    const { participant: targetParticipant } = await addParticipant(pool, encounterId, { monsterInstanceId });
    targetParticipantId = targetParticipant.id;

    await pool.query(`UPDATE encounters SET status = 'active', current_turn_index = 0 WHERE id = $1`, [encounterId]);
  });

  afterAll(async () => {
    if (campaignId) await pool.query(`DELETE FROM campaigns WHERE id = $1`, [campaignId]);
    if (dmUserId) await pool.query(`DELETE FROM users WHERE id = $1`, [dmUserId]);
    await pool.end();
  });

  it('rejects a shove attempted on behalf of a participant who is not currently up', async () => {
    await expect(
      performShove(pool, encounterId, waitingParticipantId, dmUserId, {
        targetParticipantId,
        desiredEffect: 'push_5ft',
        defenderSkill: 'athletics',
        defenderRollOverride: 1,
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT', details: { reason: 'NOT_YOUR_TURN' } });
  });

  it('allows a shove for the participant whose turn it currently is', async () => {
    const result = await performShove(pool, encounterId, activeParticipantId, dmUserId, {
      targetParticipantId,
      desiredEffect: 'push_5ft',
      defenderSkill: 'athletics',
      defenderRollOverride: 1,
    });
    expect(result.participant.action_used).toBe(true);
  });
});

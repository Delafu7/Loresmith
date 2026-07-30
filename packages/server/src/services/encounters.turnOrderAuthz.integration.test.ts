// Integration test for requireCurrentTurn as wired into applyActionEconomy
// (docs/rules/actions.md:113's confirmed gap — nothing server-side checked
// whose turn it actually was before a per-turn resource could be spent).
// Throwaway campaign/encounter fixtures, same isolation convention as
// encounters.actionEconomyUndo.integration.test.ts.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../db/pool.js';
import { addParticipant, applyActionEconomy, createEncounter } from './encounters.js';

describe('applyActionEconomy turn-order enforcement (integration, live DB, throwaway fixtures)', () => {
  let dmUserId: string;
  let campaignId: string;
  let encounterId: string;
  let activeParticipantId: string; // turn_order 0
  let waitingParticipantId: string; // turn_order 1

  beforeAll(async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const dmRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'TurnOrderAuthz Test DM', 'x') RETURNING id`,
      [`turn-order-authz-dm-${suffix}@example.test`],
    );
    dmUserId = dmRes.rows[0]!.id;

    const campaignRes = await pool.query<{ id: string }>(
      `INSERT INTO campaigns (name, dm_user_id, srd_edition) VALUES ('TurnOrderAuthz Test Campaign', $1, '2024') RETURNING id`,
      [dmUserId],
    );
    campaignId = campaignRes.rows[0]!.id;

    const charARes = await pool.query<{ id: string }>(
      `INSERT INTO characters
         (campaign_id, is_pc, owner_user_id, created_by_user_id, name, str, dex, con, int, wis, cha, armor_class, speed, hp_max, hp_current)
       VALUES ($1, true, $2, $2, 'TurnOrderAuthz PC A', 10, 10, 10, 10, 10, 10, 12, 30, 10, 10)
       RETURNING id`,
      [campaignId, dmUserId],
    );
    const characterAId = charARes.rows[0]!.id;

    const charBRes = await pool.query<{ id: string }>(
      `INSERT INTO characters
         (campaign_id, is_pc, owner_user_id, created_by_user_id, name, str, dex, con, int, wis, cha, armor_class, speed, hp_max, hp_current)
       VALUES ($1, true, $2, $2, 'TurnOrderAuthz PC B', 10, 10, 10, 10, 10, 10, 12, 30, 10, 10)
       RETURNING id`,
      [campaignId, dmUserId],
    );
    const characterBId = charBRes.rows[0]!.id;

    const encounter = await createEncounter(pool, campaignId, { name: 'TurnOrderAuthz Test Encounter' });
    encounterId = encounter.id;

    const { participant: participantA } = await addParticipant(pool, encounterId, { characterId: characterAId });
    activeParticipantId = participantA.id; // seated first -> turn_order 0
    const { participant: participantB } = await addParticipant(pool, encounterId, { characterId: characterBId });
    waitingParticipantId = participantB.id; // seated second -> turn_order 1

    // Simulate a live round with participant A (turn_order 0) currently up.
    await pool.query(`UPDATE encounters SET status = 'active', current_turn_index = 0 WHERE id = $1`, [encounterId]);
  });

  afterAll(async () => {
    if (campaignId) await pool.query(`DELETE FROM campaigns WHERE id = $1`, [campaignId]);
    if (dmUserId) await pool.query(`DELETE FROM users WHERE id = $1`, [dmUserId]);
    await pool.end();
  });

  it('allows a slot spend for the participant whose turn it currently is', async () => {
    const result = await applyActionEconomy(pool, encounterId, activeParticipantId, { spend: 'action' });
    expect(result.participant.action_used).toBe(true);
  });

  it('rejects a slot spend for a participant who is not currently up, with a machine-readable reason', async () => {
    await expect(
      applyActionEconomy(pool, encounterId, waitingParticipantId, { spend: 'action' }),
    ).rejects.toMatchObject({ code: 'CONFLICT', details: { reason: 'NOT_YOUR_TURN' } });
  });

  it('rejects a bare movement spend (no named spend) off-turn too', async () => {
    await expect(
      applyActionEconomy(pool, encounterId, waitingParticipantId, { addMovementFt: 10 }),
    ).rejects.toMatchObject({ code: 'CONFLICT', details: { reason: 'NOT_YOUR_TURN' } });
  });

  it('still allows a reaction to be spent off-turn — reactions are legitimately triggered outside the owner\'s own turn', async () => {
    const result = await applyActionEconomy(pool, encounterId, waitingParticipantId, { spend: 'reaction' });
    expect(result.participant.reaction_used).toBe(true);
  });
});

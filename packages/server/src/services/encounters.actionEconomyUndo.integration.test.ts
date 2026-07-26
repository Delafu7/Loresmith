// Integration test for REFACTOR-PLAN.md §5's object-interaction resource and
// DM undo (docs/rules/actions.md §2.3/§2.4). Throwaway campaign/encounter
// fixtures, same isolation convention as encounters.movement.integration.test.ts.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../db/pool.js';
import { addParticipant, applyActionEconomy, createEncounter, undoActionEconomy } from './encounters.js';

describe('object interaction + action-economy undo (integration, live DB, throwaway fixtures)', () => {
  let dmUserId: number;
  let campaignId: number;
  let encounterId: number;
  let participantId: number;

  beforeAll(async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const dmRes = await pool.query<{ id: number }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'ActionEconomyUndo Test DM', 'x') RETURNING id`,
      [`action-economy-undo-dm-${suffix}@example.test`],
    );
    dmUserId = dmRes.rows[0]!.id;

    const campaignRes = await pool.query<{ id: number }>(
      `INSERT INTO campaigns (name, dm_user_id, srd_edition) VALUES ('ActionEconomyUndo Test Campaign', $1, '2024') RETURNING id`,
      [dmUserId],
    );
    campaignId = campaignRes.rows[0]!.id;

    const characterRes = await pool.query<{ id: number }>(
      `INSERT INTO characters
         (campaign_id, is_pc, owner_user_id, created_by_user_id, name, str, dex, con, int, wis, cha, armor_class, speed, hp_max, hp_current)
       VALUES ($1, true, $2, $2, 'ActionEconomyUndo Test PC', 10, 10, 10, 10, 10, 10, 12, 30, 10, 10)
       RETURNING id`,
      [campaignId, dmUserId],
    );
    const characterId = characterRes.rows[0]!.id;

    const encounter = await createEncounter(pool, campaignId, { name: 'ActionEconomyUndo Test Encounter' });
    encounterId = encounter.id;
    const { participant } = await addParticipant(pool, encounterId, { characterId });
    participantId = participant.id;
  });

  afterAll(async () => {
    if (campaignId) await pool.query(`DELETE FROM campaigns WHERE id = $1`, [campaignId]);
    if (dmUserId) await pool.query(`DELETE FROM users WHERE id = $1`, [dmUserId]);
    await pool.end();
  });

  it('first object interaction is free; a second is rejected until the action slot pays for it', async () => {
    const first = await applyActionEconomy(pool, encounterId, participantId, { spend: 'object_interaction' });
    expect(first.participant.object_interaction_used).toBe(true);
    expect(first.participant.action_used).toBe(false);

    await expect(
      applyActionEconomy(pool, encounterId, participantId, { spend: 'object_interaction' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    // Undo to restore a clean slate for the next test.
    await undoActionEconomy(pool, encounterId, participantId);
  });

  it('undo is scoped to the LAST mutation only — a dash spend followed by a movement spend leaves the dash unrevertable by a single undo', async () => {
    const dashed = await applyActionEconomy(pool, encounterId, participantId, { spend: 'action', dash: true });
    expect(dashed.participant.dash_used).toBe(true);

    const afterMove = await applyActionEconomy(pool, encounterId, participantId, { addMovementFt: 55 });
    expect(afterMove.participant.movement_used_ft).toBe(55);

    // The dash+movement spends are two separate applyActionEconomy calls;
    // the single-slot snapshot was overwritten by the second one, so undo
    // reverts ONLY the movement add — dash_used stays true. This is the
    // intentional "smallest mechanism" scope from docs/rules/actions.md
    // §2.4 (a snapshot, not a stack), not a bug.
    const undone = await undoActionEconomy(pool, encounterId, participantId);
    expect(undone.participant.movement_used_ft).toBe(0);
    expect(undone.participant.dash_used).toBe(true);

    // Nothing left to undo — the dash spend's own snapshot was already
    // discarded when the movement spend overwrote it.
    await expect(undoActionEconomy(pool, encounterId, participantId)).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('a plain action spend can be undone back to unused', async () => {
    const spent = await applyActionEconomy(pool, encounterId, participantId, { spend: 'bonus_action' });
    expect(spent.participant.bonus_action_used).toBe(true);

    const undone = await undoActionEconomy(pool, encounterId, participantId);
    expect(undone.participant.bonus_action_used).toBe(false);
  });
});

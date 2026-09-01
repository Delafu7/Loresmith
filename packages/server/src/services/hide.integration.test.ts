// Integration test for performHide (services/hide.ts, docs/roadmap/
// dnd-2024-gap-analysis.md P1-13) — mirrors grapple.integration.test.ts's
// fixture shape. Since there's no defenderRollOverride equivalent (the
// actor's own Stealth check is never client-overridable — see
// schemas/hide.ts's header comment), success/failure is made deterministic
// by setting the fixture PC's Dex score extreme enough that even the
// server's real 1d20 roll can't cross DC 15 the wrong way.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../db/pool.js';
import { addParticipant, createEncounter } from './encounters.js';
import { performHide } from './hide.js';

describe('performHide (integration, live DB, throwaway fixtures)', () => {
  let dmUserId: string;
  let campaignId: string;
  let encounterId: string;

  beforeAll(async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const dmRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'Hide Test DM', 'x') RETURNING id`,
      [`hide-test-dm-${suffix}@example.test`],
    );
    dmUserId = dmRes.rows[0]!.id;

    const campaignRes = await pool.query<{ id: string }>(
      `INSERT INTO campaigns (name, dm_user_id, srd_edition) VALUES ('Hide Test Campaign', $1, '2024') RETURNING id`,
      [dmUserId],
    );
    campaignId = campaignRes.rows[0]!.id;
    await pool.query(`INSERT INTO campaign_members (campaign_id, user_id, role) VALUES ($1, $2, 'dm')`, [campaignId, dmUserId]);

    const encounter = await createEncounter(pool, campaignId, { name: 'Hide Test Encounter' });
    encounterId = encounter.id;
    await pool.query(`UPDATE encounters SET status = 'active', current_turn_index = 0 WHERE id = $1`, [encounterId]);
  });

  afterAll(async () => {
    if (campaignId) {
      // active_effects.source_character_id has no ON DELETE CASCADE from
      // characters — clear the Invisible effect this test applied before
      // the campaign cascade deletes its source character out from under it
      // (same precaution grapple.integration.test.ts already takes).
      await pool.query(`DELETE FROM active_effects WHERE source_character_id IN (SELECT id FROM characters WHERE campaign_id = $1)`, [campaignId]);
      await pool.query(`DELETE FROM campaigns WHERE id = $1`, [campaignId]);
    }
    if (dmUserId) await pool.query(`DELETE FROM users WHERE id = $1`, [dmUserId]);
    await pool.end();
  });

  async function seatFreshParticipant(name: string, dex: number, initiativeRoll: number): Promise<string> {
    const charRes = await pool.query<{ id: string }>(
      `INSERT INTO characters
         (campaign_id, is_pc, owner_user_id, created_by_user_id, name, str, dex, con, int, wis, cha, armor_class, speed, hp_max, hp_current)
       VALUES ($1, true, $2, $2, $3, 10, $4, 10, 10, 10, 10, 12, 30, 10, 10)
       RETURNING id`,
      [campaignId, dmUserId, name, dex],
    );
    const { participant } = await addParticipant(pool, encounterId, { characterId: charRes.rows[0]!.id, initiativeRoll });
    await pool.query(`UPDATE encounters SET current_turn_index = $1 WHERE id = $2`, [participant.turn_order, encounterId]);
    return participant.id;
  }

  it('a successful Hide check (DC 15) applies the Invisible effect and spends the action', async () => {
    // Dex 40 -> +15 modifier: even the worst roll (1) totals 16, always >= DC 15.
    const participantId = await seatFreshParticipant('Hide Test PC (guaranteed success)', 40, 10);

    const result = await performHide(pool, encounterId, participantId, dmUserId, {});
    expect(result.success).toBe(true);
    expect(result.participant.action_used).toBe(true);
    expect(result.checkRoll.result_total).toBeGreaterThanOrEqual(15);
    expect(result.appliedEffect).not.toBeNull();
    expect(result.appliedEffect!.effectDefinitionName).toBe('Invisible');

    const activeEffectRes = await pool.query(
      `SELECT ae.* FROM active_effects ae
       JOIN effect_definitions ed ON ed.id = ae.effect_definition_id
       WHERE ae.character_id = (SELECT character_id FROM combat_participants WHERE id = $1)
         AND ed.name = 'Invisible' AND ae.removed_at IS NULL`,
      [participantId],
    );
    expect(activeEffectRes.rows).toHaveLength(1);
    expect(activeEffectRes.rows[0]!.notes).toContain(`DC ${result.checkRoll.result_total}`);
  });

  it('a failed Hide check (DC 15) spends the action but applies no effect', async () => {
    // Dex -2 -> -6 modifier: even the best roll (20) totals 14, always < DC 15.
    const participantId = await seatFreshParticipant('Hide Test PC (guaranteed failure)', -2, 9);

    const result = await performHide(pool, encounterId, participantId, dmUserId, {});
    expect(result.success).toBe(false);
    expect(result.participant.action_used).toBe(true);
    expect(result.checkRoll.result_total).toBeLessThan(15);
    expect(result.appliedEffect).toBeNull();
  });

  it('rejects a Hide attempt when the action has already been used', async () => {
    const participantId = await seatFreshParticipant('Hide Test PC (action already used)', 40, 8);
    await pool.query(`UPDATE combat_participants SET action_used = true WHERE id = $1`, [participantId]);

    await expect(performHide(pool, encounterId, participantId, dmUserId, {})).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it("rejects a Hide attempt when it isn't that participant's turn", async () => {
    const firstId = await seatFreshParticipant('Hide Test PC (turn owner)', 40, 20);
    const secondId = await seatFreshParticipant('Hide Test PC (not their turn)', 40, 1);
    // seatFreshParticipant's own UPDATE above already moved current_turn_index
    // to secondId's seat — force it back to firstId's so secondId is the
    // out-of-turn participant this assertion actually needs.
    const firstRow = await pool.query<{ turn_order: number }>(`SELECT turn_order FROM combat_participants WHERE id = $1`, [firstId]);
    await pool.query(`UPDATE encounters SET current_turn_index = $1 WHERE id = $2`, [firstRow.rows[0]!.turn_order, encounterId]);

    await expect(performHide(pool, encounterId, secondId, dmUserId, {})).rejects.toMatchObject({
      code: 'CONFLICT',
      details: { reason: 'NOT_YOUR_TURN' },
    });
  });
});

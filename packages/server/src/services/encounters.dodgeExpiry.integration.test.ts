// Integration test for Dodge's auto-expiry (services/encounters.ts's
// advanceTurn) — "until the start of YOUR next turn" is a per-participant
// trigger, not the generic 'rounds' duration-decrement every other timed
// effect uses (see encounters.actionEconomyUndo.integration.test.ts for
// that path). Throwaway campaign/encounter fixtures, same isolation
// convention as encounters.turnOrderAuthz.integration.test.ts.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../db/pool.js';
import { addParticipant, advanceTurn, createEncounter } from './encounters.js';
import { applyEncounterEffect } from './effects.js';

describe('Dodge auto-expiry on advanceTurn (integration, live DB, throwaway fixtures)', () => {
  let dmUserId: string;
  let campaignId: string;
  let encounterId: string;
  let characterAId: string;
  let dodgeEffectDefinitionId: string;

  beforeAll(async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const dmRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'DodgeExpiry Test DM', 'x') RETURNING id`,
      [`dodge-expiry-dm-${suffix}@example.test`],
    );
    dmUserId = dmRes.rows[0]!.id;

    const campaignRes = await pool.query<{ id: string }>(
      `INSERT INTO campaigns (name, dm_user_id, srd_edition) VALUES ('DodgeExpiry Test Campaign', $1, '2024') RETURNING id`,
      [dmUserId],
    );
    campaignId = campaignRes.rows[0]!.id;

    const charARes = await pool.query<{ id: string }>(
      `INSERT INTO characters
         (campaign_id, is_pc, owner_user_id, created_by_user_id, name, str, dex, con, int, wis, cha, armor_class, speed, hp_max, hp_current)
       VALUES ($1, true, $2, $2, 'DodgeExpiry PC A', 10, 10, 10, 10, 10, 10, 12, 30, 10, 10)
       RETURNING id`,
      [campaignId, dmUserId],
    );
    characterAId = charARes.rows[0]!.id;

    const charBRes = await pool.query<{ id: string }>(
      `INSERT INTO characters
         (campaign_id, is_pc, owner_user_id, created_by_user_id, name, str, dex, con, int, wis, cha, armor_class, speed, hp_max, hp_current)
       VALUES ($1, true, $2, $2, 'DodgeExpiry PC B', 10, 10, 10, 10, 10, 10, 12, 30, 10, 10)
       RETURNING id`,
      [campaignId, dmUserId],
    );
    const characterBId = charBRes.rows[0]!.id;

    const encounter = await createEncounter(pool, campaignId, { name: 'DodgeExpiry Test Encounter' });
    encounterId = encounter.id;

    await addParticipant(pool, encounterId, { characterId: characterAId }); // turn_order 0
    await addParticipant(pool, encounterId, { characterId: characterBId }); // turn_order 1

    await pool.query(`UPDATE encounters SET status = 'active', current_turn_index = 0 WHERE id = $1`, [encounterId]);

    const defRes = await pool.query<{ id: string }>(`SELECT id FROM effect_definitions WHERE name = 'Dodge'`);
    if (!defRes.rows[0]) throw new Error(`Expected a seeded 'Dodge' effect_definitions row for this test`);
    dodgeEffectDefinitionId = defRes.rows[0].id;
  });

  afterAll(async () => {
    if (campaignId) await pool.query(`DELETE FROM campaigns WHERE id = $1`, [campaignId]);
    if (dmUserId) await pool.query(`DELETE FROM users WHERE id = $1`, [dmUserId]);
    await pool.end();
  });

  it('a Dodge effect survives turns that are not the dodging participant\'s own, and is auto-removed when their turn comes back around', async () => {
    const { effect: dodgeEffect } = await applyEncounterEffect(pool, encounterId, campaignId, {
      effectDefinitionId: dodgeEffectDefinitionId,
      characterId: characterAId,
      sourceType: 'manual',
    });
    expect(dodgeEffect.removed_at).toBeNull();

    // Advance from A's turn (0) to B's turn (1) — A's Dodge must survive.
    const afterFirstAdvance = await advanceTurn(pool, encounterId);
    expect(afterFirstAdvance.expiredEffects.map((e) => e.id)).not.toContain(dodgeEffect.id);

    const stillActiveRes = await pool.query(`SELECT removed_at FROM active_effects WHERE id = $1`, [dodgeEffect.id]);
    expect(stillActiveRes.rows[0]!.removed_at).toBeNull();

    // Advance from B's turn (1) back to A's turn (0) — NOW A's Dodge expires.
    const afterSecondAdvance = await advanceTurn(pool, encounterId);
    expect(afterSecondAdvance.expiredEffects.map((e) => e.id)).toContain(dodgeEffect.id);
    const expiredEntry = afterSecondAdvance.expiredEffects.find((e) => e.id === dodgeEffect.id);
    expect(expiredEntry?.effect_definition_name).toBe('Dodge');

    const removedRes = await pool.query(`SELECT removed_at FROM active_effects WHERE id = $1`, [dodgeEffect.id]);
    expect(removedRes.rows[0]!.removed_at).not.toBeNull();
  });

  it('a participant with no active Dodge effect advances turns without error', async () => {
    // participantB has never had Dodge applied — advancing onto their turn
    // must be a no-op for the dodge-expiry step, not an error.
    await expect(advanceTurn(pool, encounterId)).resolves.toMatchObject({});
  });
});

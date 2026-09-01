// Integration test for docs/roadmap/dnd-2024-gap-analysis.md P2-5 (ER-04) —
// the interruptible-rest flow (startRest/interruptRest/completeRest), plus
// the two auto-detection hooks (services/characters.ts's applyDamage,
// services/encounters.ts's rollAndReorderInitiative via startCombat) that
// call services/rests.ts's interruptInProgressRest. performRest (the
// instant, unconditional path) is untouched and already covered by
// rests.performRest.integration.test.ts — this file only exercises the NEW
// additive flow. Throwaway campaign/user/character fixtures, same isolation
// convention as that file.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../db/pool.js';
import { startRest, interruptRest, completeRest } from './rests.js';
import { applyDamage } from './characters.js';
import { addParticipant, createEncounter, setEncounterMode, startCombat, startEncounter } from './encounters.js';

describe('interruptible rests (integration, live DB, throwaway fixtures)', () => {
  let dmUserId: string;
  let campaignId: string;
  let fighterClassId: string;

  async function makeCharacter(hpMax: number, hpCurrent: number, name = 'Interruptible Rest Test Fighter'): Promise<string> {
    const res = await pool.query<{ id: string }>(
      `INSERT INTO characters
         (campaign_id, is_pc, owner_user_id, created_by_user_id, name, str, dex, con, int, wis, cha,
          armor_class, hp_max, hp_current)
       VALUES ($1, true, $2, $2, $3, 10, 10, 10, 10, 10, 10, 10, $4, $5)
       RETURNING id`,
      [campaignId, dmUserId, name, hpMax, hpCurrent],
    );
    const characterId = res.rows[0]!.id;
    await pool.query(`INSERT INTO character_classes (character_id, class_id, level) VALUES ($1, $2, 4)`, [characterId, fighterClassId]);
    for (const [resourceKey, rechargeOn] of [
      ['short_pool', 'short_rest'],
      ['long_pool', 'long_rest'],
    ] as const) {
      await pool.query(
        `INSERT INTO character_resource_pools (character_id, resource_key, current_value, max_value, recharge_on)
         VALUES ($1, $2, 0, 3, $3)`,
        [characterId, resourceKey, rechargeOn],
      );
    }
    return characterId;
  }

  beforeAll(async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const classRes = await pool.query<{ id: string }>(`SELECT id FROM classes WHERE index_key = 'fighter' AND edition_scope = '2024'`);
    fighterClassId = classRes.rows[0]!.id;

    const dmRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'Interruptible Rest Test DM', 'x') RETURNING id`,
      [`interrupt-rest-dm-${suffix}@example.test`],
    );
    dmUserId = dmRes.rows[0]!.id;

    const campaignRes = await pool.query<{ id: string }>(
      `INSERT INTO campaigns (name, dm_user_id, srd_edition) VALUES ('Interruptible Rest Test Campaign', $1, '2024') RETURNING id`,
      [dmUserId],
    );
    campaignId = campaignRes.rows[0]!.id;
    await pool.query(`INSERT INTO campaign_members (campaign_id, user_id, role) VALUES ($1, $2, 'dm')`, [campaignId, dmUserId]);
  });

  afterAll(async () => {
    if (campaignId) await pool.query(`DELETE FROM campaigns WHERE id = $1`, [campaignId]);
    if (dmUserId) await pool.query(`DELETE FROM users WHERE id = $1`, [dmUserId]);
    await pool.end();
  });

  it('startRest creates an in-progress rest with hp_before captured but no benefits granted yet', async () => {
    const characterId = await makeCharacter(30, 10);
    const { restEvent } = await startRest(pool, dmUserId, campaignId, { restType: 'long', characterIds: [characterId] });
    expect(restEvent.status).toBe('in_progress');

    const row = await pool.query<{ hp_before: number; hp_after: number | null }>(
      `SELECT hp_before, hp_after FROM rest_event_characters WHERE rest_event_id = $1 AND character_id = $2`,
      [restEvent.id, characterId],
    );
    expect(row.rows[0]!.hp_before).toBe(10);
    expect(row.rows[0]!.hp_after).toBeNull();

    const charRow = await pool.query<{ hp_current: number }>(`SELECT hp_current FROM characters WHERE id = $1`, [characterId]);
    expect(charRow.rows[0]!.hp_current).toBe(10); // unchanged — no benefits yet
  });

  it('startRest rejects a character with 0 HP', async () => {
    const characterId = await makeCharacter(30, 0);
    await expect(
      startRest(pool, dmUserId, campaignId, { restType: 'long', characterIds: [characterId] }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('an uninterrupted long rest, completed, grants full benefits (HP to max, hit dice restored, exhaustion -1)', async () => {
    const characterId = await makeCharacter(30, 10);
    await pool.query(`UPDATE characters SET exhaustion_level = 2, hit_dice_remaining = '{"d10":0}' WHERE id = $1`, [characterId]);
    const { restEvent } = await startRest(pool, dmUserId, campaignId, { restType: 'long', characterIds: [characterId] });

    const { characters } = await completeRest(pool, dmUserId, restEvent.id, { elapsedMinutes: 480 });
    expect(characters[0]!.wasInterrupted).toBe(false);
    expect(characters[0]!.effectiveRestType).toBe('long');
    expect(characters[0]!.hpAfter).toBe(30);
    expect(characters[0]!.exhaustionBefore).toBe(2);
    expect(characters[0]!.exhaustionAfter).toBe(1);

    const charRow = await pool.query<{ hp_current: number; exhaustion_level: number; hit_dice_remaining: Record<string, number> }>(
      `SELECT hp_current, exhaustion_level, hit_dice_remaining FROM characters WHERE id = $1`,
      [characterId],
    );
    expect(charRow.rows[0]!.hp_current).toBe(30);
    expect(charRow.rows[0]!.exhaustion_level).toBe(1);
    expect(charRow.rows[0]!.hit_dice_remaining).toEqual({ d10: 4 });
  });

  it('a long rest interrupted by damage after >= 60 minutes grants Short Rest benefits only (partial credit)', async () => {
    const characterId = await makeCharacter(30, 10);
    await pool.query(`UPDATE characters SET exhaustion_level = 2 WHERE id = $1`, [characterId]);
    const { restEvent } = await startRest(pool, dmUserId, campaignId, { restType: 'long', characterIds: [characterId] });

    // rulesGlossary.md line 1147 — "Taking any damage" interrupts the rest.
    // applyDamage's own interruptInProgressRest hook fires here.
    await applyDamage(pool, dmUserId, characterId, { diceSides: 4, diceCount: 1, modifier: 1, damageType: null, isCritical: false });

    const interruptedRow = await pool.query<{ interrupted_at: Date | null; interruption_reason: string | null }>(
      `SELECT interrupted_at, interruption_reason FROM rest_event_characters WHERE rest_event_id = $1 AND character_id = $2`,
      [restEvent.id, characterId],
    );
    expect(interruptedRow.rows[0]!.interrupted_at).not.toBeNull();
    expect(interruptedRow.rows[0]!.interruption_reason).toBe('damage');

    const { characters } = await completeRest(pool, dmUserId, restEvent.id, { elapsedMinutes: 90 });
    expect(characters[0]!.wasInterrupted).toBe(true);
    expect(characters[0]!.interruptionReason).toBe('damage');
    expect(characters[0]!.effectiveRestType).toBe('short');
    // Short Rest benefits: pools reset, but HP/exhaustion untouched (this
    // app's own "spending hit dice is a separate player action" scoping —
    // matches performRest's existing short-rest behavior exactly).
    expect(characters[0]!.exhaustionBefore).toBe(2);
    expect(characters[0]!.exhaustionAfter).toBe(2);

    const poolsRow = await pool.query<{ current_value: number }>(
      `SELECT current_value FROM character_resource_pools WHERE character_id = $1 AND resource_key = 'short_pool'`,
      [characterId],
    );
    expect(poolsRow.rows[0]!.current_value).toBe(3);
    const longPoolRow = await pool.query<{ current_value: number }>(
      `SELECT current_value FROM character_resource_pools WHERE character_id = $1 AND resource_key = 'long_pool'`,
      [characterId],
    );
    expect(longPoolRow.rows[0]!.current_value).toBe(0); // long_rest pool NOT reset — only got short-rest credit
  });

  it('a long rest interrupted before 60 minutes grants no benefits at all', async () => {
    const characterId = await makeCharacter(30, 10);
    const { restEvent } = await startRest(pool, dmUserId, campaignId, { restType: 'long', characterIds: [characterId] });
    await interruptRest(pool, dmUserId, restEvent.id, { characterId, reason: 'exertion' });

    const { characters } = await completeRest(pool, dmUserId, restEvent.id, { elapsedMinutes: 30 });
    expect(characters[0]!.effectiveRestType).toBe('none');
    expect(characters[0]!.hpAfter).toBe(10); // unchanged
    expect(Object.keys(characters[0]!.resourcesRestored)).toHaveLength(0);
  });

  it('an interrupted Short Rest confers no benefits at all, regardless of elapsed time', async () => {
    const characterId = await makeCharacter(30, 10);
    const { restEvent } = await startRest(pool, dmUserId, campaignId, { restType: 'short', characterIds: [characterId] });
    await interruptRest(pool, dmUserId, restEvent.id, { characterId, reason: 'spell' });

    const { characters } = await completeRest(pool, dmUserId, restEvent.id, { elapsedMinutes: 999 });
    expect(characters[0]!.effectiveRestType).toBe('none');

    const poolsRow = await pool.query<{ current_value: number }>(
      `SELECT current_value FROM character_resource_pools WHERE character_id = $1 AND resource_key = 'short_pool'`,
      [characterId],
    );
    expect(poolsRow.rows[0]!.current_value).toBe(0); // NOT reset — interrupted short rest confers nothing
  });

  it('completing an already-completed rest throws CONFLICT', async () => {
    const characterId = await makeCharacter(30, 10);
    const { restEvent } = await startRest(pool, dmUserId, campaignId, { restType: 'long', characterIds: [characterId] });
    await completeRest(pool, dmUserId, restEvent.id, { elapsedMinutes: 480 });

    await expect(completeRest(pool, dmUserId, restEvent.id, { elapsedMinutes: 480 })).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('interruptRest rejects a character not part of the rest, or already interrupted', async () => {
    const characterId = await makeCharacter(30, 10);
    const otherCharacterId = await makeCharacter(30, 10, 'Interruptible Rest Test Bystander');
    const { restEvent } = await startRest(pool, dmUserId, campaignId, { restType: 'long', characterIds: [characterId] });

    await expect(
      interruptRest(pool, dmUserId, restEvent.id, { characterId: otherCharacterId, reason: 'exertion' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    await interruptRest(pool, dmUserId, restEvent.id, { characterId, reason: 'exertion' });
    await expect(
      interruptRest(pool, dmUserId, restEvent.id, { characterId, reason: 'spell' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('rolling Initiative (startCombat) interrupts an in-progress rest for that character', async () => {
    const characterId = await makeCharacter(30, 10);
    const { restEvent } = await startRest(pool, dmUserId, campaignId, { restType: 'long', characterIds: [characterId] });

    const encounter = await createEncounter(pool, campaignId, { name: 'Interruptible Rest Test Encounter' });
    await addParticipant(pool, encounter.id, { characterId });
    await setEncounterMode(pool, encounter.id, { mode: 'combat' });
    await startEncounter(pool, encounter.id);
    await startCombat(pool, encounter.id);

    const row = await pool.query<{ interrupted_at: Date | null; interruption_reason: string | null }>(
      `SELECT interrupted_at, interruption_reason FROM rest_event_characters WHERE rest_event_id = $1 AND character_id = $2`,
      [restEvent.id, characterId],
    );
    expect(row.rows[0]!.interrupted_at).not.toBeNull();
    expect(row.rows[0]!.interruption_reason).toBe('initiative');
  });

  it('interruptInProgressRest is a no-op for a character with no in-progress rest (damage never throws)', async () => {
    const characterId = await makeCharacter(30, 10);
    // No startRest call at all — applyDamage must still succeed normally.
    const result = await applyDamage(pool, dmUserId, characterId, { diceSides: 4, diceCount: 1, modifier: 1, damageType: null, isCritical: false });
    expect(result.appliedDamage).toBeGreaterThan(0);
  });
});

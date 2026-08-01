// Integration tests for the map-first encounter system's turn-tracking
// rewrite: startCombat (the atomic "roll initiative for everyone + set the
// active-participant pointer" action), and the two correctness bugs the
// active_participant_id column exists to fix — a participant joining
// mid-combat, and the currently-active combatant being removed. Throwaway
// campaign/user/character fixtures, same isolation convention as
// encounters.movementMode.integration.test.ts. DM-only route authorization
// for /start-combat and /force-fullscreen is Express-middleware-only
// (requireEncounterDm, no service-level check) — per this codebase's
// established convention (see damageAuthz.integration.test.ts's own note),
// that's verified by a live smoke test, not here.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../db/pool.js';
import {
  addParticipant,
  createEncounter,
  removeParticipant,
  setEncounterMode,
  startCombat,
  startEncounter,
} from './encounters.js';

describe('startCombat / mid-combat join / remove-active-combatant (integration, live DB, throwaway fixtures)', () => {
  let dmUserId: string;
  let campaignId: string;
  let characterAId: string;
  let characterBId: string;
  let characterCId: string;

  async function makeCharacter(name: string): Promise<string> {
    const res = await pool.query<{ id: string }>(
      `INSERT INTO characters
         (campaign_id, is_pc, owner_user_id, created_by_user_id, name, str, dex, con, int, wis, cha,
          armor_class, speed, hp_max, hp_current)
       VALUES ($1, true, $2, $2, $3, 10, 10, 10, 10, 10, 10, 12, 30, 10, 10)
       RETURNING id`,
      [campaignId, dmUserId, name],
    );
    return res.rows[0]!.id;
  }

  beforeAll(async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const dmRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'StartCombat Test DM', 'x') RETURNING id`,
      [`start-combat-dm-${suffix}@example.test`],
    );
    dmUserId = dmRes.rows[0]!.id;

    const campaignRes = await pool.query<{ id: string }>(
      `INSERT INTO campaigns (name, dm_user_id, srd_edition) VALUES ('StartCombat Test Campaign', $1, '2024') RETURNING id`,
      [dmUserId],
    );
    campaignId = campaignRes.rows[0]!.id;

    characterAId = await makeCharacter('StartCombat PC A');
    characterBId = await makeCharacter('StartCombat PC B');
    characterCId = await makeCharacter('StartCombat PC C');
  });

  afterAll(async () => {
    if (campaignId) await pool.query(`DELETE FROM campaigns WHERE id = $1`, [campaignId]);
    if (dmUserId) await pool.query(`DELETE FROM users WHERE id = $1`, [dmUserId]);
    await pool.end();
  });

  it('rejects starting combat on an encounter with zero participants', async () => {
    const encounter = await createEncounter(pool, campaignId, { name: 'Empty Encounter' });
    await startEncounter(pool, encounter.id);
    await expect(startCombat(pool, encounter.id)).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('rejects starting combat before the encounter is active', async () => {
    const encounter = await createEncounter(pool, campaignId, { name: 'Preparing Encounter' });
    await addParticipant(pool, encounter.id, { characterId: characterAId });
    await expect(startCombat(pool, encounter.id)).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('a single participant immediately becomes active, in round 1', async () => {
    const encounter = await createEncounter(pool, campaignId, { name: 'Solo Encounter' });
    await startEncounter(pool, encounter.id);
    const { participant } = await addParticipant(pool, encounter.id, { characterId: characterAId });

    const { encounter: started, participants } = await startCombat(pool, encounter.id);
    expect(started.mode).toBe('combat');
    expect(started.current_round).toBe(1);
    expect(started.active_participant_id).toBe(participant.id);
    expect(started.current_turn_index).toBe(participants[0]!.turn_order);
    expect(participants[0]!.initiative_roll).not.toBe(-9999);
  });

  it('a participant added mid-combat gets rolled in without disturbing whoever is currently active', async () => {
    const encounter = await createEncounter(pool, campaignId, { name: 'Mid-Combat Join Encounter' });
    await startEncounter(pool, encounter.id);
    await addParticipant(pool, encounter.id, { characterId: characterAId });
    await addParticipant(pool, encounter.id, { characterId: characterBId });
    const { encounter: started } = await startCombat(pool, encounter.id);
    const activeIdBefore = started.active_participant_id;
    expect(activeIdBefore).not.toBeNull();

    const { participant: latecomer, encounter: afterJoin } = await addParticipant(pool, encounter.id, {
      characterId: characterCId,
    });
    expect(latecomer.initiative_roll).not.toBe(-9999); // rolled immediately, not left unrolled
    // The active participant must not have silently changed just because
    // turn_order got reassigned to fit the latecomer in.
    expect(afterJoin.active_participant_id).toBe(activeIdBefore);

    // current_turn_index must still equal the (possibly-shifted) turn_order
    // of whoever active_participant_id actually points at — this is the
    // exact invariant requireCurrentTurn/canMoveToken.ts rely on.
    const activeRow = await pool.query<{ turn_order: number }>(
      `SELECT turn_order FROM combat_participants WHERE id = $1`,
      [afterJoin.active_participant_id],
    );
    expect(afterJoin.current_turn_index).toBe(activeRow.rows[0]!.turn_order);
  });

  it('removing the currently-active combatant advances to a real next participant, not a dangling pointer', async () => {
    const encounter = await createEncounter(pool, campaignId, { name: 'Remove Active Encounter' });
    await startEncounter(pool, encounter.id);
    const { participant: pA } = await addParticipant(pool, encounter.id, { characterId: characterAId });
    const { participant: pB } = await addParticipant(pool, encounter.id, { characterId: characterBId });
    await startCombat(pool, encounter.id);

    // Force a known order: A first, B second, regardless of the random roll.
    await pool.query(`UPDATE combat_participants SET turn_order = 0 WHERE id = $1`, [pA.id]);
    await pool.query(`UPDATE combat_participants SET turn_order = 1 WHERE id = $1`, [pB.id]);
    await pool.query(`UPDATE encounters SET active_participant_id = $1, current_turn_index = 0 WHERE id = $2`, [pA.id, encounter.id]);

    const { encounter: afterRemove } = await removeParticipant(pool, encounter.id, pA.id);
    expect(afterRemove.active_participant_id).toBe(pB.id);
    expect(afterRemove.current_turn_index).toBe(1);
  });

  it('removing the last remaining participant while it is active clears the pointer instead of leaving it dangling', async () => {
    const encounter = await createEncounter(pool, campaignId, { name: 'Remove Last Encounter' });
    await startEncounter(pool, encounter.id);
    const { participant } = await addParticipant(pool, encounter.id, { characterId: characterAId });
    await startCombat(pool, encounter.id);

    const { encounter: afterRemove } = await removeParticipant(pool, encounter.id, participant.id);
    expect(afterRemove.active_participant_id).toBeNull();
  });

  it('ending combat (mode -> exploration) leaves positions, HP, and the participant roster completely untouched', async () => {
    const encounter = await createEncounter(pool, campaignId, { name: 'End Combat Preserves State Encounter' });
    await startEncounter(pool, encounter.id);
    const { participant } = await addParticipant(pool, encounter.id, { characterId: characterAId });
    await startCombat(pool, encounter.id);
    await pool.query(`UPDATE combat_participants SET pos_x = 4, pos_y = 2 WHERE id = $1`, [participant.id]);

    const before = await pool.query(`SELECT * FROM combat_participants WHERE encounter_id = $1`, [encounter.id]);
    const encounterBefore = await pool.query(
      `SELECT active_participant_id, current_turn_index FROM encounters WHERE id = $1`,
      [encounter.id],
    );

    await setEncounterMode(pool, encounter.id, { mode: 'exploration' });

    const after = await pool.query(`SELECT * FROM combat_participants WHERE encounter_id = $1`, [encounter.id]);
    expect(after.rows).toEqual(before.rows);
    const encounterAfter = await pool.query(
      `SELECT active_participant_id, current_turn_index, mode FROM encounters WHERE id = $1`,
      [encounter.id],
    );
    expect(encounterAfter.rows[0]!.mode).toBe('exploration');
    expect(encounterAfter.rows[0]!.active_participant_id).toBe(encounterBefore.rows[0]!.active_participant_id);
    expect(encounterAfter.rows[0]!.current_turn_index).toBe(encounterBefore.rows[0]!.current_turn_index);
  });
});

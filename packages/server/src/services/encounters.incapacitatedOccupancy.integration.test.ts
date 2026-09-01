// Integration test for docs/roadmap/dnd-2024-gap-analysis.md P2-1 (CB-01) —
// proves the actual wiring (loadMovementContext's new is_incapacitated
// subquery, feeding services/movement.ts's Occupant.isIncapacitated), not
// just the pure movement.ts functions (movement.test.ts already covers the
// passability math itself in isolation). Single-row (gridRows: 1) corridor
// map, same "no cheaper diagonal detour" trick movement.test.ts's own
// difficult-terrain tests use, so a blocked path can only mean the occupancy
// check itself blocked it, not that Dijkstra just routed around. Throwaway
// campaign/encounter fixtures, same isolation convention as
// encounters.movement.integration.test.ts.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../db/pool.js';
import {
  addParticipant,
  createEncounter,
  setEncounterMode,
  setParticipantPosition,
  startEncounter,
  upsertEncounterMap,
} from './encounters.js';
import { applyMonsterInstanceEffect, removeEffect } from './effects.js';
import { createHomebrewMonster } from './monsterCatalog.js';

describe('2024 Incapacitated occupancy exception (integration, live DB, throwaway fixtures)', () => {
  let dmUserId: string;
  let campaignId: string;
  let encounterId: string;
  let moverParticipantId: string;
  let enemyInstanceId: string;
  let stunnedEffectDefinitionId: string;

  beforeAll(async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const dmRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'IncapOccupancy Test DM', 'x') RETURNING id`,
      [`incap-occupancy-dm-${suffix}@example.test`],
    );
    dmUserId = dmRes.rows[0]!.id;

    const campaignRes = await pool.query<{ id: string }>(
      `INSERT INTO campaigns (name, dm_user_id, srd_edition) VALUES ('IncapOccupancy Test Campaign', $1, '2024') RETURNING id`,
      [dmUserId],
    );
    campaignId = campaignRes.rows[0]!.id;
    await pool.query(`INSERT INTO campaign_members (campaign_id, user_id, role) VALUES ($1, $2, 'dm')`, [campaignId, dmUserId]);

    const characterRes = await pool.query<{ id: string }>(
      `INSERT INTO characters
         (campaign_id, is_pc, owner_user_id, created_by_user_id, name, str, dex, con, int, wis, cha,
          armor_class, speed, hp_max, hp_current)
       VALUES ($1, true, $2, $2, 'IncapOccupancy Test PC', 10, 10, 10, 10, 10, 10, 12, 30, 10, 10)
       RETURNING id`,
      [campaignId, dmUserId],
    );
    const characterId = characterRes.rows[0]!.id;

    const enemyMonster = await createHomebrewMonster(pool, campaignId, dmUserId, {
      name: 'IncapOccupancy Test Medium Enemy', size: 'medium', creatureType: 'humanoid', armorClass: 12, hitPointAverage: 10,
      hitDice: '2d8', speed: { walk: 30 }, str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10,
      challengeRating: 1, xpValue: 200, actions: [{ name: 'Slam', description: '1d4 bludgeoning.' }],
    });
    await pool.query(`INSERT INTO campaign_bestiary_entries (campaign_id, monster_id) VALUES ($1, $2)`, [campaignId, enemyMonster.id]);
    const enemyInstanceRes = await pool.query<{ id: string }>(
      `INSERT INTO monster_instances (campaign_id, monster_id, hp_current) VALUES ($1, $2, 10) RETURNING id`,
      [campaignId, enemyMonster.id],
    );
    enemyInstanceId = enemyInstanceRes.rows[0]!.id;

    const encounter = await createEncounter(pool, campaignId, { name: 'IncapOccupancy Test Encounter' });
    encounterId = encounter.id;
    // 1-row corridor: (1,0) is the ONLY route from (0,0) to (2,0) — no
    // cheaper diagonal detour Dijkstra could take around a blocked occupant.
    await upsertEncounterMap(pool, encounterId, { gridColumns: 3, gridRows: 1, feetPerCell: 5 });

    const { participant: mover } = await addParticipant(pool, encounterId, { characterId });
    moverParticipantId = mover.id;
    await addParticipant(pool, encounterId, { monsterInstanceId: enemyInstanceId, faction: 'enemy' });

    await setParticipantPosition(pool, encounterId, moverParticipantId, { x: 0, y: 0 }, 'dm');
    // setParticipantPosition takes a PARTICIPANT id, not a monster_instance id.
    const enemyParticipantRes = await pool.query<{ id: string }>(
      `SELECT id FROM combat_participants WHERE encounter_id = $1 AND monster_instance_id = $2`,
      [encounterId, enemyInstanceId],
    );
    await setParticipantPosition(pool, encounterId, enemyParticipantRes.rows[0]!.id, { x: 1, y: 0 }, 'dm');

    await setEncounterMode(pool, encounterId, { mode: 'combat' });
    await startEncounter(pool, encounterId);

    const stunnedRes = await pool.query<{ id: string }>(`SELECT id FROM effect_definitions WHERE name = 'Stunned' AND is_homebrew = false`);
    if (!stunnedRes.rows[0]) throw new Error("Expected a seeded 'Stunned' effect_definitions row for this test");
    stunnedEffectDefinitionId = stunnedRes.rows[0]!.id;
  });

  afterAll(async () => {
    if (campaignId) await pool.query(`DELETE FROM campaigns WHERE id = $1`, [campaignId]);
    if (dmUserId) await pool.query(`DELETE FROM users WHERE id = $1`, [dmUserId]);
    await pool.end();
  });

  it('a same-size hostile occupant blocks the path outright when NOT Incapacitated', async () => {
    await expect(
      setParticipantPosition(pool, encounterId, moverParticipantId, { x: 2, y: 0 }, 'dm'),
    ).rejects.toMatchObject({ code: 'CONFLICT', details: { reason: 'BLOCKED_PATH' } });
  });

  it('the same occupant becomes passable (difficult-terrain rate) once Stunned (implies Incapacitated) is active', async () => {
    const { effect } = await applyMonsterInstanceEffect(pool, dmUserId, enemyInstanceId, {
      effectDefinitionId: stunnedEffectDefinitionId, sourceType: 'manual',
    });

    const { participant } = await setParticipantPosition(pool, encounterId, moverParticipantId, { x: 2, y: 0 }, 'dm');
    expect(participant.pos_x).toBe(2);
    expect(participant.pos_y).toBe(0);
    // 5 (normal cell 1) + 10 (difficult-terrain-rate occupied cell 2) = 15,
    // same math as movement.test.ts's Tiny-exception case.
    expect(participant.movement_used_ft).toBe(15);

    await removeEffect(pool, dmUserId, (effect as { id: string }).id);
  });

  it('blocks again once the Incapacitated-implying effect is removed', async () => {
    // Fresh mover seat so movement_used_ft/pos_x start over.
    const characterRes = await pool.query<{ id: string }>(
      `INSERT INTO characters
         (campaign_id, is_pc, owner_user_id, created_by_user_id, name, str, dex, con, int, wis, cha,
          armor_class, speed, hp_max, hp_current)
       VALUES ($1, true, $2, $2, 'IncapOccupancy Test PC Two', 10, 10, 10, 10, 10, 10, 12, 30, 10, 10)
       RETURNING id`,
      [campaignId, dmUserId],
    );
    const { participant: secondMover } = await addParticipant(pool, encounterId, { characterId: characterRes.rows[0]!.id, initiativeRoll: 1 });
    await setParticipantPosition(pool, encounterId, secondMover.id, { x: 0, y: 0 }, 'dm');
    await pool.query(`UPDATE encounters SET current_turn_index = $1 WHERE id = $2`, [secondMover.turn_order, encounterId]);

    await expect(
      setParticipantPosition(pool, encounterId, secondMover.id, { x: 2, y: 0 }, 'dm'),
    ).rejects.toMatchObject({ code: 'CONFLICT', details: { reason: 'BLOCKED_PATH' } });
  });
});

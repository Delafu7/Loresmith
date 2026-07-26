// Integration test for REFACTOR-PLAN.md §3's snapshot additions: `size` and
// `faction` must actually flow through getEncounterCombatSnapshot (the query
// FULL_STATE_SYNC is built from), not just exist as unused columns. Uses the
// seeded demo encounter (read-only assertions, no mutation), same fixture
// convention as encounters.initiative.integration.test.ts.

import { afterAll, describe, expect, it } from 'vitest';
import { pool } from '../db/pool.js';
import { getEncounterCombatSnapshot } from './encounters.js';

const DEMO_ENCOUNTER_ID = 1;

describe('getEncounterCombatSnapshot size/faction fields (integration, live DB, read-only)', () => {
  afterAll(async () => {
    await pool.end();
  });

  it('every participant has a real size and a valid faction, PCs default to player faction', async () => {
    const { participants } = await getEncounterCombatSnapshot(pool, DEMO_ENCOUNTER_ID);
    expect(participants.length).toBeGreaterThan(0);

    for (const p of participants) {
      expect(typeof p.size).toBe('string');
      expect(p.size.length).toBeGreaterThan(0);
      expect(['player', 'ally', 'enemy', 'neutral']).toContain(p.faction);
      if (p.is_pc) {
        expect(p.faction).toBe('player');
      }
    }
  });

  it("a monster-instance participant's size matches its catalog monster's size column exactly", async () => {
    const { participants } = await getEncounterCombatSnapshot(pool, DEMO_ENCOUNTER_ID);
    const monsterParticipant = participants.find((p) => p.monster_instance_id != null);
    expect(monsterParticipant).toBeDefined();

    const monsterRes = await pool.query<{ size: string }>(
      `SELECT m.size FROM monster_instances mi JOIN monsters m ON m.id = mi.monster_id WHERE mi.id = $1`,
      [monsterParticipant!.monster_instance_id],
    );
    expect(monsterParticipant!.size).toBe(monsterRes.rows[0]!.size);
  });

  it('a character participant (no monster_instance_id) falls back to the Medium default', async () => {
    const { participants } = await getEncounterCombatSnapshot(pool, DEMO_ENCOUNTER_ID);
    const characterParticipant = participants.find((p) => p.character_id != null);
    expect(characterParticipant).toBeDefined();
    expect(characterParticipant!.size).toBe('Medium');
  });
});

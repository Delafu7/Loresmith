// Integration test for the initiative tiebreak/ordering rule in
// rollInitiative(): highest roll first, DEX-mod tiebreak, then participant
// id as a final stable tiebreak (an implementation convenience so ties don't
// flap between calls — not a 5e rule, and with UUID ids there's no
// insertion-order correlation to lean on anymore, so this compares against
// plain string ordering of whichever two ids the fixture actually gets
// rather than assuming which one sorts first). This talks to the real dev
// Postgres (the docker-compose instance this project already uses for
// manual verification) against the seeded demo encounter, since the
// ordering is expressed as a SQL ORDER BY rather than a pure JS function.
// Original initiative values are captured and restored afterward so the
// demo seed data is left untouched. Looked up by encounter name, not a
// hardcoded id — ids are UUIDs now, generated fresh per seed run.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../db/pool.js';
import { rollInitiative } from './encounters.js';

let DEMO_ENCOUNTER_ID: string;

interface ParticipantRow {
  id: string;
  initiative_roll: number;
  initiative_tiebreak: number | null;
  turn_order: number;
}

describe('rollInitiative ordering (integration, live DB)', () => {
  let original: ParticipantRow[] = [];

  beforeAll(async () => {
    const encRes = await pool.query<{ id: string }>(`SELECT id FROM encounters WHERE name = 'Ambush on the Old Road'`);
    DEMO_ENCOUNTER_ID = encRes.rows[0]!.id;

    const res = await pool.query<ParticipantRow>(
      `SELECT id, initiative_roll, initiative_tiebreak, turn_order FROM combat_participants WHERE encounter_id = $1 ORDER BY id`,
      [DEMO_ENCOUNTER_ID],
    );
    original = res.rows;
    if (original.length < 3) {
      throw new Error('Expected the seeded demo encounter to have at least 3 participants for this test');
    }
  });

  afterAll(async () => {
    for (const row of original) {
      await pool.query(
        `UPDATE combat_participants SET initiative_roll = $1, initiative_tiebreak = $2, turn_order = $3 WHERE id = $4`,
        [row.initiative_roll, row.initiative_tiebreak, row.turn_order, row.id],
      );
    }
    await pool.end();
  });

  it('sorts by initiative_roll desc, then tiebreak desc, then id asc, and does not reroll existing values', async () => {
    const [a, b, c] = original;

    // Deliberately: a and b tie on roll (forcing the tiebreak field to
    // matter), c is clearly highest. a has the lower id of the tied pair but
    // a *lower* tiebreak, so it must sort after b despite the lower id.
    await pool.query(`UPDATE combat_participants SET initiative_roll = 15, initiative_tiebreak = 1 WHERE id = $1`, [a!.id]);
    await pool.query(`UPDATE combat_participants SET initiative_roll = 15, initiative_tiebreak = 3 WHERE id = $1`, [b!.id]);
    await pool.query(`UPDATE combat_participants SET initiative_roll = 20, initiative_tiebreak = 0 WHERE id = $1`, [c!.id]);

    const { participants } = await rollInitiative(pool, DEMO_ENCOUNTER_ID, false);

    const order = participants
      .filter((p: any) => [a!.id, b!.id, c!.id].includes(p.id))
      .sort((x: any, y: any) => x.turn_order - y.turn_order)
      .map((p: any) => p.id);

    expect(order).toEqual([c!.id, b!.id, a!.id]);

    // force:false must not have touched the values we just set, since none
    // of them were the "unrolled" sentinel.
    const refetched = await pool.query<ParticipantRow>(
      `SELECT id, initiative_roll, initiative_tiebreak, turn_order FROM combat_participants WHERE id = ANY($1)`,
      [[a!.id, b!.id, c!.id]],
    );
    const byId = new Map(refetched.rows.map((r) => [r.id, r]));
    expect(byId.get(a!.id)?.initiative_roll).toBe(15);
    expect(byId.get(c!.id)?.initiative_roll).toBe(20);
  });
});

import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

// Map-first encounter system — turn tracking moves from a dense 0..N-1
// `turn_order` index (`current_turn_index`) to a stable reference: which
// PARTICIPANT is active, not which numeric slot. The dense-index scheme
// breaks the moment a participant is removed mid-combat (the remaining
// rows' turn_order values leave a gap that current_turn_index's plain
// +1-mod-count arithmetic doesn't know how to skip) or when rollInitiative
// re-sorts everyone to fold in a latecomer (current_turn_index isn't
// updated, so it can end up pointing at a different participant than the
// one who was actually mid-turn). Referencing the row directly sidesteps
// both: `services/encounters.ts`'s new computeNextTurn finds the current
// row in `ORDER BY turn_order` and walks to the next one, which works
// whether or not turn_order is dense. ON DELETE SET NULL lets
// removeParticipant detect "the active combatant was just deleted" instead
// of silently leaving a foreign-key-violating reference.
//
// current_turn_index is kept (not dropped) as a derived/display value —
// still written by advanceTurn for callers that read it — rather than
// migrating every consumer of EncounterLiveState.encounter.currentTurnIndex
// in this same pass.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    ALTER TABLE encounters
      ADD COLUMN active_participant_id UUID REFERENCES combat_participants(id) ON DELETE SET NULL;

    -- Backfill: for any encounter already mid-combat, resolve today's
    -- current_turn_index against turn_order to find who it actually points
    -- at, same join advanceTurn's own "starting participant" query already
    -- does today.
    UPDATE encounters e
    SET active_participant_id = cp.id
    FROM combat_participants cp
    WHERE cp.encounter_id = e.id
      AND cp.turn_order = e.current_turn_index
      AND e.status = 'active';
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    ALTER TABLE encounters DROP COLUMN active_participant_id;
  `);
}

import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

// Phase 2 "legendary actions per-round counters" + "lair actions
// (round-start trigger)" — landed in one migration since both are "add a
// descriptive/mechanical encounter-setup field" and the plan's own guidance
// was to avoid two near-identical ALTER TABLE encounters migrations back to
// back.
//
// legendary_action_count (monsters): budget per round for this monster
// TYPE — a catalog fact ("a beholder gets 3 legendary actions"), nullable
// (most monsters have none). legendary_actions_remaining
// (combat_participants): the live counter for THIS SEATING of that monster
// in THIS encounter, reset every round by advanceTurn (services/
// encounters.ts) once the round boundary crosses, not on that participant's
// own turn starting (a legendary action is spent on OTHER creatures' turns).
//
// lair_actions (encounters): a lair belongs to a place/scene, not a monster
// type — the DM sets it up per-encounter at prep time, not per-monster.
// Round-start trigger (confirmed decision — not literal initiative count
// 20, since turn order isn't stored with real initiative-20 granularity).
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    ALTER TABLE monsters ADD COLUMN legendary_action_count INT;
    ALTER TABLE combat_participants ADD COLUMN legendary_actions_remaining INT;
    ALTER TABLE encounters ADD COLUMN lair_actions JSONB;
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    ALTER TABLE encounters DROP COLUMN lair_actions;
    ALTER TABLE combat_participants DROP COLUMN legendary_actions_remaining;
    ALTER TABLE monsters DROP COLUMN legendary_action_count;
  `);
}

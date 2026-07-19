import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

// Per-turn 5e action economy (action/bonus action/reaction/movement),
// scoped to combat_participants since it's meaningless outside an
// encounter and resets every turn (services/encounters.ts's advanceTurn
// resets these for whichever participant's turn is starting, in the same
// transaction as the turn advance itself). `dash_used` is separate from
// `action_used` — Dash consumes the action slot AND doubles the movement
// budget, so the frontend needs to know specifically that Dash (not some
// other action) was spent to compute the doubled cap. All default to
// false/0, reproducing today's behavior exactly (no encounter previously
// tracked this at all).
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    ALTER TABLE combat_participants ADD COLUMN action_used BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE combat_participants ADD COLUMN bonus_action_used BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE combat_participants ADD COLUMN reaction_used BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE combat_participants ADD COLUMN dash_used BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE combat_participants ADD COLUMN movement_used_ft INT NOT NULL DEFAULT 0;
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    ALTER TABLE combat_participants DROP COLUMN action_used;
    ALTER TABLE combat_participants DROP COLUMN bonus_action_used;
    ALTER TABLE combat_participants DROP COLUMN reaction_used;
    ALTER TABLE combat_participants DROP COLUMN dash_used;
    ALTER TABLE combat_participants DROP COLUMN movement_used_ft;
  `);
}

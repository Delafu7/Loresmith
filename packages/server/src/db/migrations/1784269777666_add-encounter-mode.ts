import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

// Exploration mode (any player moves their own token freely, no turn order,
// no movement limit) vs. combat mode (today's strict turn/budget-enforced
// movement) — a mode flag on the encounter itself, independent of `status`,
// so a DM can toggle it at will (e.g. free-roam movement mid-"active"
// encounter for out-of-initiative narrative movement) without it being tied
// to start/end combat. Defaults to 'exploration' for brand-new encounters
// (nothing to enforce yet, matches "preparing" being an unconditional-move
// state today).
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    ALTER TABLE encounters ADD COLUMN mode TEXT NOT NULL DEFAULT 'exploration'
      CHECK (mode IN ('exploration', 'combat'));
  `);
  // Any encounter already mid-combat at deploy time keeps strict movement
  // enforcement instead of every in-flight game silently losing it the
  // moment this ships.
  pgm.sql(`UPDATE encounters SET mode = 'combat' WHERE status IN ('active', 'paused');`);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`ALTER TABLE encounters DROP COLUMN mode;`);
}

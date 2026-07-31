import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

// Encounter visibility by state (nav point 1) — a per-participant hide/
// reveal flag, deliberately reintroducing the shape of the old
// `hp_visibility`/`visible_to_players` columns removed in
// 1784269769666_remove-hide-reveal-except-weaknesses. That removal was
// correct for HP/AC/effect *field* redaction (still gone, not reinstated),
// but this is a different axis: whether the participant ROW exists at all
// in a non-DM's view — e.g. an ambush monster the DM hasn't revealed yet.
// Defaults true so every existing/newly-added participant stays visible
// with no behavior change until a DM explicitly hides one.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    ALTER TABLE combat_participants ADD COLUMN visible_to_players BOOLEAN NOT NULL DEFAULT true;
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    ALTER TABLE combat_participants DROP COLUMN visible_to_players;
  `);
}

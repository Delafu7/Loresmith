import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

// Phase 2 "restore hp_visibility + banding" — a deliberate reversal of
// 1784269769666_remove-hide-reveal-except-weaknesses.ts, which dropped this
// exact column. That migration's own down() already had the DDL below as a
// template; reused verbatim. 'banded' is the default (not 'exact') — a
// player should have to be told a creature's exact HP is showing, not the
// other way around.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    ALTER TABLE combat_participants ADD COLUMN hp_visibility TEXT NOT NULL DEFAULT 'banded'
      CHECK (hp_visibility IN ('exact','banded','hidden'));
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`ALTER TABLE combat_participants DROP COLUMN hp_visibility;`);
}

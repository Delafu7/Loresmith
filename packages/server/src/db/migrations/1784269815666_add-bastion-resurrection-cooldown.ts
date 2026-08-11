import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

// Phase 4 "Bastion tracking" sub-phase 4 — the 100 BP "return to life at
// next dawn" benefit "cannot be used again until the character gains at
// least one level since the last use" (docs/rules/bastions.md §3). Tracked
// as the owning character's total level AT the time of the last use; the
// next attempt is only allowed once the character's CURRENT total level
// (recomputed live from character_classes, never cached) exceeds this.
// NULL = never used.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`ALTER TABLE bastions ADD COLUMN last_resurrection_character_level INT;`);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`ALTER TABLE bastions DROP COLUMN last_resurrection_character_level;`);
}

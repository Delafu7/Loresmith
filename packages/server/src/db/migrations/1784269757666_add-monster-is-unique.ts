import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

// Catalog-level flag (not per-instance) — a stat block like a named
// legendary villain is unique by definition, regardless of which campaign
// spawns it, so this lives on `monsters` next to is_homebrew rather than on
// `monster_instances`. Default false reproduces today's exact behavior
// (multiple instances of any monster already allowed pre-this-migration —
// see services/monsters.ts's createMonsterInstance, which had no cap at
// all); enforcement of the cap is a service-layer check
// (createMonsterInstance now locks the monster row and counts existing
// instances), same "app-layer, not declarative" precedent as the
// homebrew-scope/asset-ownership checks already in this codebase.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    ALTER TABLE monsters ADD COLUMN is_unique BOOLEAN NOT NULL DEFAULT false;
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    ALTER TABLE monsters DROP COLUMN is_unique;
  `);
}

import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

// Phase 2 roadmap P1-1 (docs/roadmap/dnd-2024-gap-analysis.md, CB-06) —
// death saving throw state machine. `characters.is_alive` already exists
// but is never written after INSERT anywhere in services/characters.ts, and
// a bare boolean can't represent the three real states a 0-HP creature is
// in (actively dying / stable / dead). See docs/rules/death-saving-throws.md
// §2.1 for the full rules citation and data-model rationale, including why
// "Stable" is a column here rather than an active_effects row (it is not
// one of the 15 catalog conditions in either SRD edition).
//
// Scoped to `characters` only this phase — monster_instances keep their
// existing instant-death-at-0-HP default unchanged (docs/rules/
// death-saving-throws.md §1.9/§2.2's `uses_death_saves` opt-in is a
// deliberate follow-up, not built here).

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    ALTER TABLE characters ADD COLUMN death_save_successes SMALLINT NOT NULL DEFAULT 0 CHECK (death_save_successes BETWEEN 0 AND 3);
    ALTER TABLE characters ADD COLUMN death_save_failures  SMALLINT NOT NULL DEFAULT 0 CHECK (death_save_failures  BETWEEN 0 AND 3);
    ALTER TABLE characters ADD COLUMN is_stable            BOOLEAN  NOT NULL DEFAULT false;
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    ALTER TABLE characters DROP COLUMN IF EXISTS is_stable;
    ALTER TABLE characters DROP COLUMN IF EXISTS death_save_failures;
    ALTER TABLE characters DROP COLUMN IF EXISTS death_save_successes;
  `);
}

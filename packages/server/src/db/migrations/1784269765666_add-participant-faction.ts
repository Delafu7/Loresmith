import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

// REFACTOR-PLAN.md §3: "a colored border for faction (player / ally / enemy
// / neutral)". Nothing in the schema tracked this before — a character
// participant and a monster-instance participant were only ever
// distinguished by which FK was set, which is only a two-state signal
// (PC vs. not) and can't represent an allied NPC or a neutral bystander.
// Defaults backfilled for existing rows: PCs -> 'player', everything else
// (monster instances, NPCs) -> 'enemy', matching this app's existing
// default-HP-visibility precedent (exact for PCs, banded otherwise) of
// assuming "the other side" unless told otherwise. The DM can override any
// participant's faction after the fact (new PATCH .../faction route).
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    ALTER TABLE combat_participants ADD COLUMN faction TEXT NOT NULL DEFAULT 'enemy'
      CHECK (faction IN ('player', 'ally', 'enemy', 'neutral'));
    UPDATE combat_participants SET faction = 'player' WHERE character_id IS NOT NULL;
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    ALTER TABLE combat_participants DROP COLUMN faction;
  `);
}

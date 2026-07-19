import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

// SRD-validation amendments from PLAN.md §3.3/§3.4 (both folded into §3.2
// verbatim):
//
// 1. `class_multiclass_prerequisites` — a single `classes.primary_ability_id`
//    (Phase 1) can't express two-ability multiclass prereqs (Paladin needs
//    STR 13 AND CHA 13; Ranger/Monk need DEX 13 AND WIS 13), so this is a
//    proper join keyed (class_id, ability_score_id).
// 2. `multiclass_spell_slot_table` — the combined-caster-level slot table is
//    NOT the sum of each class's own `class_levels.spell_slots`. Full casters
//    count their level 1:1 toward "combined caster level", half-casters
//    (Paladin/Ranger) count level÷2 (round down), third-casters (Eldritch
//    Knight/Arcane Trickster) count level÷3 (round down); the SUM of those
//    per-class contributions indexes this table. `classes.spellcasting_type`
//    (already present from Phase 1) is what the app-layer computation reads
//    to know which divisor applies per class.

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    CREATE TABLE class_multiclass_prerequisites (
      class_id         BIGINT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
      ability_score_id BIGINT NOT NULL REFERENCES ability_scores(id),
      minimum_score    INT NOT NULL,
      PRIMARY KEY (class_id, ability_score_id)
    );

    CREATE TABLE multiclass_spell_slot_table (
      combined_caster_level INT PRIMARY KEY CHECK (combined_caster_level BETWEEN 1 AND 20),
      spell_slots JSONB NOT NULL
    );
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    DROP TABLE IF EXISTS multiclass_spell_slot_table;
    DROP TABLE IF EXISTS class_multiclass_prerequisites;
  `);
}

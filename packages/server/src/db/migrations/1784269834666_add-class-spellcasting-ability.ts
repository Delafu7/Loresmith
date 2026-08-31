// docs/roadmap/dnd-2024-gap-analysis.md P1-7 (SP-03) — enforcing the
// prepared-spell cap ("class level + spellcasting ability modifier, min 1")
// needs to know WHICH ability each class prepares with. `classes` already
// carries `primary_ability_id`, but that column is the MULTICLASS
// PREREQUISITE ability (e.g. Fighter: STR or DEX) — a different concept
// that's frequently NOT the spellcasting ability (Paladin's multiclass
// prereq is STR or CHA; its spellcasting ability is CHA alone). Conflating
// the two would silently mis-cap Paladin/Ranger. This is a new, dedicated
// column, seeded straight from each class's own SRD data
// (`5e-SRD-Classes.json`'s `spellcasting.spellcasting_ability.index`, the
// same per-class JSON this project already treats as ground truth for
// spellcasting_type/spell slot tables) — see db/seeds/catalog.ts's
// seedClassesAndSubclasses for the seeding.
//
// NULL for every non-caster class (Barbarian/Fighter/Monk/Rogue), and for
// any homebrew class until homebrew class creation grows a field for it —
// services/characterSpells.ts's cap check treats a NULL here as "can't
// compute a cap, don't block" rather than as a zero-spell cap.

import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    ALTER TABLE classes ADD COLUMN spellcasting_ability_id UUID REFERENCES ability_scores(id);
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    ALTER TABLE classes DROP COLUMN IF EXISTS spellcasting_ability_id;
  `);
}

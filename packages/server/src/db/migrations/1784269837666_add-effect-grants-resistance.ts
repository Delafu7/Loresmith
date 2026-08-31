// docs/roadmap/dnd-2024-gap-analysis.md P1-11 (CB-02) — Rage-style
// *temporary* damage resistance. docs/rules/attacks-and-damage.md §2.4
// (this project's own prior design doc, corroborated by OPEN_QUESTIONS.md
// item 7) already specified the shape: a *permanent*, build-derived
// resistance source (a Dwarf's poison resistance) belongs in
// characters.damage_resistances (already exists); a *temporary*,
// toggle-on-toggle-off source (a Barbarian's Rage) should instead be a
// field on the effect_definitions TEMPLATE, unioned with the permanent
// columns at read time by computeAppliedDamage's caller — never written
// into the permanent columns, which is exactly the "DM forgets to remove it
// when Rage ends" bug that design avoids.
//
// TEXT[] NOT NULL DEFAULT '{}', matching every other damage-type array
// column in this schema (characters/monsters' own damage_resistances etc.)
// — see attacks-and-damage.md §3 edge case 10 for why NOT NULL DEFAULT '{}'
// over a nullable column.

import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    ALTER TABLE effect_definitions ADD COLUMN grants_resistance TEXT[] NOT NULL DEFAULT '{}';
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    ALTER TABLE effect_definitions DROP COLUMN IF EXISTS grants_resistance;
  `);
}

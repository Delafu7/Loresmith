import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

// SRD-validation review finding (Phase 2 review): `class_multiclass_
// prerequisites` was AND-only across every row for a class, which is correct
// for every SRD class EXCEPT Fighter — whose real prerequisite is "Strength
// 13 OR Dexterity 13", not AND. `requirement_group` fixes this generally:
// rows sharing (class_id, requirement_group) are OR'd together (any one
// satisfies that group); a class's distinct requirement_groups are still
// AND'd (every group must have at least one satisfied row). Paladin/Ranger/
// Monk's two abilities move to distinct groups (0 and 1, still AND); Fighter's
// STR/DEX move to the SAME group (0, now OR). See db/seeds/catalog.ts's
// MULTICLASS_PREREQS and services/spellSlots.ts's validateMulticlassPrerequisites.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    ALTER TABLE class_multiclass_prerequisites
      ADD COLUMN requirement_group INT NOT NULL DEFAULT 0;
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    ALTER TABLE class_multiclass_prerequisites
      DROP COLUMN requirement_group;
  `);
}

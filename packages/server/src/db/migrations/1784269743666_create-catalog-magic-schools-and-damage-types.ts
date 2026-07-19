import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

// Phase 2 prerequisite: PLAN.md §3.2 lists `damage_types` and `magic_schools`
// as edition-invariant catalog lookups, but Phase 1 didn't create them (no
// Phase 1 table referenced them yet). They're needed now as real FK targets
// before `spells` (school_id NOT NULL) and `items` (damage_type_id) can be
// created — same "create the small lookup first" move Phase 1 made for
// `feats` ahead of `backgrounds.granted_feat_id`.
//
// Not seeded from the dnd5e-srd skill's JSON (it has no such files, same
// story as spells/items/monsters) — the catalog seed hardcodes the fixed
// SRD list (8 schools, 13 damage types) directly.

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    CREATE TABLE damage_types (
      id BIGSERIAL PRIMARY KEY, index_key TEXT NOT NULL UNIQUE, name TEXT NOT NULL, description TEXT
    );

    CREATE TABLE magic_schools (
      id BIGSERIAL PRIMARY KEY, index_key TEXT NOT NULL UNIQUE, name TEXT NOT NULL, description TEXT
    );
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    DROP TABLE IF EXISTS magic_schools;
    DROP TABLE IF EXISTS damage_types;
  `);
}

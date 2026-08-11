import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

// Phase 4 "Bastion tracking" sub-phase 1 — the facilities CATALOG (shared,
// rarely-mutated reference data, same category as races/classes/spells/
// monsters per this project's catalog/instance split). Campaign-instance
// tables (bastions, bastion_facilities, bastion_turns, bastion_orders) are
// a later sub-phase, once this catalog exists to reference.
//
// Sourcing: NOT SRD content. Confirmed absent from `.opencode/skills/
// dnd5e-srd/` and every free official WotC rules page — Bastions are paid
// 2024 Dungeon Master's Guide content with no free full-text equivalent.
// Seeded from WotC's own free "Unearthed Arcana 2023: Bastions and
// Cantrips" playtest PDF, corroborated against the shipped final book only
// where a Nov 2024 D&D Beyond staff post independently restates a detail
// (see docs/rules/bastions.md's Source note for the full corroboration
// table and per-section confidence levels). Never cite this table's
// contents as "SRD 5.2" in code or UI copy.
//
// 2014 has no Bastion system at all — edition_scope is pinned to a literal
// '2024' CHECK (not the races/classes-style '2014'|'2024'|'both' enum)
// since no other value can ever legally occur here; kept as a real column
// anyway purely for naming consistency with every other catalog table.
//
// order_type deliberately excludes 'maintain' from its CHECK, even though
// docs/rules/bastions.md's own schema sketch included it for enum-symmetry
// with the wider order vocabulary: Maintain is issued to the whole Bastion,
// never to an individual facility (see bastion_orders, a later migration,
// which excludes it from ITS order_type CHECK for the identical reason), so
// no facility catalog row can ever legitimately carry it — allowing the
// value here would just be a live foot-gun with no real use, the same class
// of mistake PLAN.md already flags for encounter_templates.target_difficulty
// mixing 2014/2024 vocabularies.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    CREATE TABLE bastion_facility_catalog (
      id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      index_key         TEXT NOT NULL UNIQUE,
      name              TEXT NOT NULL,
      facility_type     TEXT NOT NULL CHECK (facility_type IN ('basic', 'special')),
      edition_scope     TEXT NOT NULL DEFAULT '2024' CHECK (edition_scope = '2024'),
      min_level         INT,                          -- NULL for basic facilities; 5/9/13/17 for special
      prerequisite_text TEXT,                          -- human-readable; NOT a structured/queryable rule -- see
                                                         -- docs/rules/bastions.md's Edge cases on why prerequisites
                                                         -- like "Fighting Style feature" can't be a denormalized
                                                         -- boolean without risking drift from a character's actual
                                                         -- class features
      default_space     TEXT CHECK (default_space IN ('cramped', 'roomy', 'vast')), -- fixed for special facilities;
                                                         -- NULL for basic (player picks any size at construction)
      hireling_count    INT,                            -- NULL for basic facilities AND for War Room (its count
                                                         -- varies -- starts at 2, grows via Recruit, see benefits)
      order_type        TEXT CHECK (order_type IN ('craft', 'empower', 'harvest', 'recruit', 'research', 'trade')),
      bp_die            TEXT,                           -- '1d4' | '1d6' | '1d8' | '1d10'; NULL for basic facilities
      benefits          JSONB,                          -- prose summary of facility-specific mechanical benefits --
                                                         -- genuinely variable per-facility structure (Craft/Harvest
                                                         -- sub-options, Pub Special table, etc.), matches this
                                                         -- project's "JSONB only for genuinely variable, unqueried
                                                         -- structure" precedent; nothing here is ever filtered/
                                                         -- sorted/joined across facilities
      source_note       TEXT NOT NULL DEFAULT 'UA 2023 playtest text; not independently re-confirmed against final 2024 DMG numeric details -- see docs/rules/bastions.md'
    );
    CREATE INDEX ON bastion_facility_catalog (facility_type);
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`DROP TABLE IF EXISTS bastion_facility_catalog;`);
}

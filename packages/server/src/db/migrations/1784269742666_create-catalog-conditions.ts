import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

// Phase 2: `conditions` catalog (PLAN.md §3.2, verbatim) — flavor-text-only
// per §3.1 ("`conditions` is flavor text only. `effect_definitions` is the
// app-owned mechanical template"). Needed now as the FK target for
// `effect_definitions.condition_id` (next Phase 2 migration).
//
// Unlike `languages` (edition-invariant, merged into one row per index when
// identical across editions), the dnd5e-srd skill's 2014 and 2024 condition
// text is NOT identical — 2024 rewrote every condition's description in a
// different format/wording (see `data/2024/5e-SRD-Conditions.json`'s
// `description` string field vs. 2014's `desc` string array). So this table
// gets one row per (index_key, edition) like races/classes/feats/
// backgrounds, never edition_scope='both'.

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    CREATE TABLE conditions (
      id BIGSERIAL PRIMARY KEY,
      index_key TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      edition_scope TEXT NOT NULL DEFAULT 'both' CHECK (edition_scope IN ('2014','2024','both')),
      UNIQUE (index_key, edition_scope)
    );
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`DROP TABLE IF EXISTS conditions;`);
}

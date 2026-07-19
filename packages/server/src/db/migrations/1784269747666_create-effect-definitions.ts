import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

// `effect_definitions` (PLAN.md §3.2, verbatim) — the app-owned mechanical
// effect/condition TEMPLATE: duration type/value, concentration, stacking
// rule. `conditions` (previous Phase 2 migration) is flavor text only;
// `active_effects` (a later Phase 2 migration) is the applied instance with
// a real duration countdown, save DC, source, and target — per the §3.1
// catalog/instance split for effects.
//
// Catalog table with a homebrew-scoping escape hatch: `is_homebrew` +
// `owning_campaign_id` lets a single DM add a custom effect definition
// scoped to only their campaign, without polluting the global catalog shared
// by every other campaign — the CHECK keeps a non-homebrew row from ever
// carrying a campaign owner.

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    CREATE TABLE effect_definitions (
      id BIGSERIAL PRIMARY KEY,
      condition_id BIGINT REFERENCES conditions(id),
      name TEXT NOT NULL,
      description TEXT,
      default_duration_type TEXT NOT NULL CHECK (default_duration_type IN
        ('rounds','minutes','hours','until_save','until_removed','permanent','special')),
      default_duration_value INT,
      concentration BOOLEAN NOT NULL DEFAULT false,
      stacking_rule TEXT NOT NULL DEFAULT 'refresh' CHECK (stacking_rule IN ('none','stack','refresh')),
      is_homebrew BOOLEAN NOT NULL DEFAULT false,
      owning_campaign_id BIGINT REFERENCES campaigns(id) ON DELETE CASCADE,
      CHECK (is_homebrew OR owning_campaign_id IS NULL)
    );
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`DROP TABLE IF EXISTS effect_definitions;`);
}

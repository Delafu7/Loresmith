import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

// Phase 2 "weapon mastery (2024)" — the 8 SRD 5.2 mastery properties
// (Cleave/Graze/Nick/Push/Sap/Slow/Topple/Vex), a 2024-only mechanic. Same
// shape as damage_types/magic_schools (1784269743666): a small,
// edition-invariant-AS-A-TABLE, fixed reference list with no homebrew
// column — not because campaigns could ever add a NINTH mastery property,
// but because the game only ever defines these eight. Which of `items`
// (edition_scope='both') gets which mastery goes on that row's own
// properties JSONB `mastery` key (services/db/seeds/catalog.ts), not a
// second table here — 2014-edition campaigns simply never surface it
// (see AttackRoller/InventoryPanel's srd_edition gate), matching the
// existing "shared catalog row, edition-gated display" precedent already
// used for weapon properties in general.
export async function up(pgm: MigrationBuilder): Promise<void> {
  // UUID, not BIGSERIAL — 1784269770666_uuid-primary-keys.ts already
  // converted every catalog table (including damage_types/magic_schools,
  // whose original BIGSERIAL shape this table's header comment references)
  // to UUID; this table is created after that migration, so it uses the
  // current convention directly rather than the stale one those older
  // tables started with.
  pgm.sql(`
    CREATE TABLE weapon_mastery_properties (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), index_key TEXT NOT NULL UNIQUE, name TEXT NOT NULL, description TEXT NOT NULL
    );
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`DROP TABLE IF EXISTS weapon_mastery_properties;`);
}

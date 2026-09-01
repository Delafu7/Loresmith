import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

// docs/roadmap/dnd-2024-gap-analysis.md P2-7 (CC-04) — "surface trinkets in
// the wizard" turned out to need the trinket CATALOG DATA first: despite the
// original finding's claim, no trinket data (seed, table, or column) exists
// anywhere in this repo — confirmed by grep across db/seeds/catalog.ts, the
// SRD source JSON, and every migration before this one. Trinkets are modeled
// as ordinary `items` rows (item_type='trinket') rather than a parallel
// table, so a chosen trinket becomes a real character_items inventory row
// through the SAME existing pipeline every other piece of starting gear
// already uses — no new join table, no new "how do I add this to the
// character sheet" plumbing. Constraint name confirmed against the live dev
// DB via pg_get_constraintdef before writing this, same discipline the
// pending-action-kind/theme-widening migrations already used.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    ALTER TABLE items DROP CONSTRAINT items_item_type_check;
  `);
  pgm.sql(`
    ALTER TABLE items ADD CONSTRAINT items_item_type_check
      CHECK (item_type IN ('weapon','armor','shield','tool','adventuring_gear','magic_item','consumable','mount','vehicle','trinket'));
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    DELETE FROM items WHERE item_type = 'trinket';
  `);
  pgm.sql(`
    ALTER TABLE items DROP CONSTRAINT items_item_type_check;
  `);
  pgm.sql(`
    ALTER TABLE items ADD CONSTRAINT items_item_type_check
      CHECK (item_type IN ('weapon','armor','shield','tool','adventuring_gear','magic_item','consumable','mount','vehicle'));
  `);
}

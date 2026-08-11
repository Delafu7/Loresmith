import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

// Phase 3 "terrain/complications on encounters" — free-text, DM-authored at
// prep time, but (unlike lair_actions) visible to every campaign member —
// difficult terrain and environmental hazards are things players can see
// and react to at the table, not secret DM state. Same "add a descriptive/
// mechanical encounter-setup field" shape as lair_actions
// (1784269804666_add-legendary-and-lair-actions.ts), landed as its own
// migration only because that one already shipped by the time this item
// started (the plan's own guidance was to combine them if both were still
// pending).
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`ALTER TABLE encounters ADD COLUMN terrain_notes TEXT;`);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`ALTER TABLE encounters DROP COLUMN terrain_notes;`);
}

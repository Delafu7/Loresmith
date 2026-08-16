import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

// DM hide/reveal for NPCs — same narrow-exception shape as
// 1784269826666_add-locations-factions-visibility.ts (a `visible_to_players`
// boolean, filtered via services/visibility.ts's 'role_split' mode). Added to
// `characters` rather than a separate npcs table since NPCs already live
// there (is_pc = false) alongside PCs; a PC (is_pc = true) always bypasses
// this column in services/characters.ts's requireCharacterVisible, so its
// value is meaningless for PC rows.
//
// Defaults to false (hidden), matching the locations/factions precedent's
// "new content is created HIDDEN by default" — applied to the backfill too,
// since every existing NPC predates this column and the DM hasn't reviewed
// any of them for player visibility yet.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`ALTER TABLE characters ADD COLUMN visible_to_players BOOLEAN NOT NULL DEFAULT false;`);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`ALTER TABLE characters DROP COLUMN visible_to_players;`);
}

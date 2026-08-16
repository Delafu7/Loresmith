import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

// DM hide/reveal for locations and factions — same narrow-exception shape as
// 1784269793666_readd-campaign-assets-visibility.ts (a `visible_to_players`
// boolean, filtered via services/visibility.ts's 'role_split' mode), not
// notes.ts's three-state 'gm_only'/'revealed_to_players'/'owner_only' enum —
// locations/factions have no per-row owner/author, only DM-authored content,
// so the extra 'owner_only' state would never be reachable here.
//
// Defaults to false (hidden): unlike campaign_assets/notes, which default to
// visible for backward compatibility with pre-existing rows, this feature's
// target state is "new content is created HIDDEN by default" — applied to
// the backfill too, since every existing location/faction predates this
// column and the DM hasn't reviewed any of them for player visibility yet.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    ALTER TABLE locations ADD COLUMN visible_to_players BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE factions ADD COLUMN visible_to_players BOOLEAN NOT NULL DEFAULT false;
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    ALTER TABLE factions DROP COLUMN visible_to_players;
    ALTER TABLE locations DROP COLUMN visible_to_players;
  `);
}

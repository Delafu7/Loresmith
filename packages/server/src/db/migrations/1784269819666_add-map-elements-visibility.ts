import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

// GM-only visibility layer (nav point 2) — map_elements.visible_to_players
// was a boolean the server never actually enforced (GET /:id/map/elements
// returned every row to every viewer regardless of it; only the CLIENT
// hid 'note'-type elements from non-DM viewers, and did so unconditionally,
// ignoring this column entirely for that type). Replacing it with the same
// 3-state 'visibility' enum notes just gained (1784269818666), plus a
// nullable owner_user_id for the 'owner_only' case — unlike notes, a map
// element has no natural "author" column to reuse, so this one genuinely
// needs its own owner column.
//
// Backfill: visible_to_players=false -> 'gm_only' (preserves the column's
// existing meaning exactly, for the types where it actually mattered).
// visible_to_players=true -> 'revealed_to_players', EXCEPT every
// type='note' row, which always backfills to 'gm_only' regardless of its
// stored boolean: notes were *always* DM-only in actual behavior (the
// client hardcoded this, ignoring visible_to_players for that type), so
// preserving real behavior on migrate matters more than preserving a flag
// value the app never actually honored.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    ALTER TABLE map_elements ADD COLUMN visibility TEXT NOT NULL DEFAULT 'revealed_to_players'
      CHECK (visibility IN ('gm_only', 'revealed_to_players', 'owner_only'));
    ALTER TABLE map_elements ADD COLUMN owner_user_id UUID REFERENCES users(id) ON DELETE SET NULL;

    UPDATE map_elements SET visibility = 'gm_only' WHERE visible_to_players = false;
    UPDATE map_elements SET visibility = 'gm_only' WHERE type = 'note';

    ALTER TABLE map_elements DROP COLUMN visible_to_players;

    CREATE INDEX ON map_elements (map_id, visibility);
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    ALTER TABLE map_elements ADD COLUMN visible_to_players BOOLEAN NOT NULL DEFAULT true;
    UPDATE map_elements SET visible_to_players = (visibility != 'gm_only' AND visibility != 'owner_only');

    ALTER TABLE map_elements DROP COLUMN visibility;
    ALTER TABLE map_elements DROP COLUMN owner_user_id;
  `);
}

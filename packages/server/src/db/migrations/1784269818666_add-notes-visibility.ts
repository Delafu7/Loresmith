import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

// GM-only visibility layer (nav point 2) — notes.visible_to_players was
// removed entirely in a prior migration ("visible to the whole campaign
// now"), which meant DM prep notes had no way to stay hidden from players.
// Reintroducing this as a 3-state enum rather than the old boolean: a note
// can be DM-only ('gm_only'), visible to the whole campaign
// ('revealed_to_players'), or visible only to the DM plus its own author
// ('owner_only' — reuses the existing author_user_id column as the owner,
// no separate owner column needed here since a note always has exactly one
// author already).
//
// Backfill (user-approved default): a note authored by a user who held
// role='dm' in campaign_members for that note's campaign at migration time
// stays 'gm_only' (the column DEFAULT already gives this for every row — no
// UPDATE needed). A note authored by a 'player' backfills to
// 'revealed_to_players', preserving today's "every note visible to
// everyone" behavior for player-authored notes specifically — the DM-notes
// leak is what's being closed here, not player notes' existing visibility.
// A note whose author's campaign_members row is gone (removed member) or
// whose author held 'spectator' (shouldn't currently be reachable —
// createNote is gated requireRole('not-spectator')) falls through to the
// 'gm_only' default, the safe direction to fail in.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    ALTER TABLE notes ADD COLUMN visibility TEXT NOT NULL DEFAULT 'gm_only'
      CHECK (visibility IN ('gm_only', 'revealed_to_players', 'owner_only'));

    UPDATE notes n
    SET visibility = 'revealed_to_players'
    FROM campaign_members cm
    WHERE cm.campaign_id = n.campaign_id
      AND cm.user_id = n.author_user_id
      AND cm.role = 'player';

    CREATE INDEX ON notes (campaign_id, visibility);
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    ALTER TABLE notes DROP COLUMN visibility;
  `);
}

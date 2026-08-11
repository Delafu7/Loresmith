import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

// Phase 1.4 of the backlog implementation plan: sessions.recap is the DM's
// full write-up (spoilers, next-session prep notes, secrets) and today's
// GET /campaigns/:id/sessions[/:sid] hands it to every campaign member
// verbatim — no role split exists at all for session logs, unlike every
// other DM-authored freeform field in this app. player_recap is the
// player-facing version; recap stays DM-only from here on (redacted in
// services/campaigns.ts the same way redactGmNotes hides characters.gm_notes).
// A session recap is campaign-wide, not per-character, so entity_visibility
// (Phase 1.3) would be the wrong tool here — a plain column is enough.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`ALTER TABLE sessions ADD COLUMN player_recap TEXT;`);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`ALTER TABLE sessions DROP COLUMN player_recap;`);
}

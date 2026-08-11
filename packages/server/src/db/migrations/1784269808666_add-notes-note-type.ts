import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

// Phase 3 "rulings log" — piggybacks on `notes` via a discriminator column
// rather than a new table, matching this codebase's existing preference
// (dice_rolls.roll_type, active_effects.source_type). Gets full-text search
// for free from the search_vector column Phase 3's "full-text search on
// notes" item just added (it indexes title+body regardless of note_type).
// No new visibility mechanism — a ruling is a rules clarification meant for
// the whole table, not DM-secret content, and every note in this app is
// already visible to every campaign member.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    ALTER TABLE notes ADD COLUMN note_type TEXT NOT NULL DEFAULT 'note' CHECK (note_type IN ('note', 'ruling'));
    CREATE INDEX ON notes (campaign_id, note_type);
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`ALTER TABLE notes DROP COLUMN note_type;`);
}

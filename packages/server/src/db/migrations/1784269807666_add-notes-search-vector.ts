import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

// Phase 3 "full-text search on notes" — finishes the deferral
// 1784269741666_create-sessions-and-notes.ts's own header comment
// anticipated ("no search_vector / GIN index (full-text search is Phase
// 3)"). Generated column (STORED, not a trigger) so it's always in sync
// with title/body with no application-code upkeep; 'english' config matches
// this app's only supported UI language family for stemming purposes (a
// search feature, not stored content, so this doesn't need per-locale
// handling the way translated UI strings do). Scoped to `notes` only for
// v1, per the plan — plot threads/locations (Phase 3, still unbuilt as of
// this migration) get their own search pass later rather than trying to
// union everything into one index now.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    ALTER TABLE notes ADD COLUMN search_vector tsvector
      GENERATED ALWAYS AS (
        setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
        setweight(to_tsvector('english', coalesce(body, '')), 'B')
      ) STORED;
    CREATE INDEX notes_search_vector_idx ON notes USING GIN (search_vector);
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    DROP INDEX IF EXISTS notes_search_vector_idx;
    ALTER TABLE notes DROP COLUMN search_vector;
  `);
}

import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

// docs/roadmap/dnd-2024-gap-analysis.md P2-5 (ER-04) — rest interruption
// tracking. `rest_events.status` defaults to 'completed' so every EXISTING
// row, and every row `performRest` (the instant, unconditional "resolve
// right now" path — unchanged, kept for the common no-interruption case)
// still creates, is unaffected: only the NEW startRest/completeRest flow
// ever produces an 'in_progress' row.
//
// `rest_event_characters.hp_after` must become nullable — an in-progress
// rest's participation row is inserted with only `hp_before` known;
// `hp_after`/`resources_restored` are filled in when the rest actually
// completes (`completeRest`), same "write it when you know it" shape
// `resources_restored` (already nullable) already had.
//
// `interrupted_at`/`interruption_reason` are per-CHARACTER (not per-event):
// rulesGlossary.md's 4 interruption sources (rolling Initiative, taking
// damage, casting a non-cantrip spell, 1 hour of exertion) are each
// individually a property of ONE creature's own rest, not a blanket
// "the whole party's rest ends" switch — two characters resting together
// can be interrupted independently (e.g. only one of them takes damage).
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    ALTER TABLE rest_events ADD COLUMN status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('in_progress', 'completed'));
    ALTER TABLE rest_event_characters ALTER COLUMN hp_after DROP NOT NULL;
    ALTER TABLE rest_event_characters ADD COLUMN interrupted_at TIMESTAMPTZ;
    ALTER TABLE rest_event_characters ADD COLUMN interruption_reason TEXT
      CHECK (interruption_reason IN ('initiative', 'damage', 'spell', 'exertion'));
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    ALTER TABLE rest_event_characters DROP COLUMN interruption_reason;
    ALTER TABLE rest_event_characters DROP COLUMN interrupted_at;
    ALTER TABLE rest_event_characters ALTER COLUMN hp_after SET NOT NULL;
    ALTER TABLE rest_events DROP COLUMN status;
  `);
}

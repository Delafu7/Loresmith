import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

// Orthogonal to combat_participants.faction (1784269765666): faction is
// "which side is this participant on" (board-coloring, per-row), while
// disposition is "is this scene currently a fight" (one value per
// encounter — friendly/neutral/hostile/unknown, e.g. a negotiation that can
// turn hostile mid-conversation). Modeled as a first-class transition
// (encounter_disposition_events), not a raw PATCH-able field, so "the DM
// turned this hostile" has a who/when/why the same way combat_actions
// already logs in-fight events — see 1784269782666_create-combat-actions.ts.
// Defaults to 'neutral' for both new and existing encounters: unlike
// faction (which had a knowable PC-vs-not signal to backfill from), there is
// no prior data implying a specific disposition, so no seed UPDATE is
// needed here — 'neutral' is the correct meaning of "we don't know yet"
// prior to any explicit transition.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    ALTER TABLE encounters ADD COLUMN disposition TEXT NOT NULL DEFAULT 'neutral'
      CHECK (disposition IN ('friendly', 'neutral', 'hostile', 'unknown'));

    CREATE TABLE encounter_disposition_events (
      id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      encounter_id       UUID NOT NULL REFERENCES encounters(id) ON DELETE CASCADE,
      from_disposition   TEXT NOT NULL CHECK (from_disposition IN ('friendly', 'neutral', 'hostile', 'unknown')),
      to_disposition     TEXT NOT NULL CHECK (to_disposition IN ('friendly', 'neutral', 'hostile', 'unknown')),
      changed_by_user_id UUID NOT NULL REFERENCES users(id),
      note               TEXT,
      created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX ON encounter_disposition_events (encounter_id, created_at);
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    DROP TABLE encounter_disposition_events;
    ALTER TABLE encounters DROP COLUMN disposition;
  `);
}

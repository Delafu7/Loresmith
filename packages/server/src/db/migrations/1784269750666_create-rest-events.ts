import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

// `rest_events`/`rest_event_characters` (PLAN.md §3.2, verbatim) — a log of
// short/long rests and their per-character effect (HP restored, resources
// restored), campaign-scoped instance data. `resources_restored` is JSONB
// (variable shape per class/resource, write-once/read-rarely — same
// judgment call §3.3 item 2 makes for `dice_rolls.result_breakdown`).

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    CREATE TABLE rest_events (
      id                   BIGSERIAL PRIMARY KEY,
      campaign_id          BIGINT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      rest_type            TEXT NOT NULL CHECK (rest_type IN ('short','long')),
      occurred_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
      initiated_by_user_id BIGINT REFERENCES users(id),
      notes                TEXT
    );

    CREATE TABLE rest_event_characters (
      rest_event_id      BIGINT NOT NULL REFERENCES rest_events(id) ON DELETE CASCADE,
      character_id       BIGINT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
      hp_before          INT NOT NULL,
      hp_after           INT NOT NULL,
      resources_restored JSONB,
      PRIMARY KEY (rest_event_id, character_id)
    );
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    DROP TABLE IF EXISTS rest_event_characters;
    DROP TABLE IF EXISTS rest_events;
  `);
}

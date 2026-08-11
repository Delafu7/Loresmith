import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

// Phase 3 "campaign calendar" — a DM-entered, manual timeline of in-world
// events. No auto-advance logic: the DM decides when in-game time passes
// (session-to-session or mid-session) and logs events against that day
// count themselves.
//
// in_game_day is an INT (days since an arbitrary campaign epoch — day 0 is
// "campaign start," not tied to any real calendar), not free text, so
// events sort/compare correctly and future durations (e.g. "the ritual
// takes 3 days") can do plain arithmetic against it. This is the same
// representation Phase 4's Bastion turns will anchor to — settled here
// first so Bastion doesn't invent a second, competing time system.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    CREATE TABLE campaign_events (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      campaign_id  UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      in_game_day  INT NOT NULL,
      title        TEXT NOT NULL,
      description  TEXT,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX ON campaign_events (campaign_id, in_game_day);
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`DROP TABLE IF EXISTS campaign_events;`);
}

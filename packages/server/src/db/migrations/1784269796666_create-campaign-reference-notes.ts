import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

// Iteration 4 — a per-campaign, DM-only scratchpad for crucial reference
// info (rest-rule reminders, travel distances to named places, anything
// else the DM wants at a glance). A NEW, dedicated, always-GM-only
// resource — not a reuse of `notes` (whose own header comment records that
// its visible_to_players column was deliberately removed app-wide) and not
// built on the general hide/reveal engine that removal took out. One row
// per campaign, created lazily on first PUT; campaign_id is the PK so
// there's never more than one.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    CREATE TABLE campaign_reference_notes (
      campaign_id UUID PRIMARY KEY REFERENCES campaigns(id) ON DELETE CASCADE,
      body        TEXT NOT NULL DEFAULT '',
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    DROP TABLE IF EXISTS campaign_reference_notes;
  `);
}

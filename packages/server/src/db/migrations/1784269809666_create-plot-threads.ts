import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

// Phase 3 "plot threads" — staleness (now() - last_touched_at) is computed
// on READ, never stored (matches the existing shared_campaign_count
// subquery precedent in campaignBestiary.ts) — last_touched_at itself IS a
// real stored column, bumped by updatePlotThread/touchPlotThread
// (services/plotThreads.ts) whenever the DM edits or explicitly "touches"
// a thread (mentions it again without otherwise changing it).
//
// description (TEXT) isn't in the plan's own sketch, which only lists
// title/status/origin_session_id/last_touched_at — added here as a
// reasonably necessary minimum (a thread titled "The Lost Amulet" needs
// somewhere to say what it actually is, same as notes.body).
//
// Visibility wires through entity_visibility (Phase 1.3, entity_type =
// 'plot_thread') rather than a plain boolean like sessions.player_recap —
// unlike a session recap (one shared campaign-wide DM/player split), a
// plot thread can reasonably be known to some players and not others (e.g.
// a secret tied to one PC's backstory), which is exactly the per-user
// granularity entity_visibility exists for.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    CREATE TABLE plot_threads (
      id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      campaign_id       UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      title             TEXT NOT NULL,
      description       TEXT,
      status            TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
      origin_session_id UUID REFERENCES sessions(id) ON DELETE SET NULL,
      last_touched_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX ON plot_threads (campaign_id, status);
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`DROP TABLE IF EXISTS plot_threads;`);
}

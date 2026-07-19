import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

// `sessions` here is the session-LOG table (one row per game night), not to
// be confused with the Redis-backed HTTP session store used for auth.
//
// `notes` is deliberately the Phase-1-trimmed version of PLAN.md §3.2:
//  - no `search_vector` / GIN index (full-text search is Phase 3)
//  - no `tags` / `note_tags` (tagging is Phase 3)
//  - no `location_id` column at all (no `locations` table exists yet in
//    Phase 1 — same treatment as `encounters.location_id`; Phase 3's
//    `locations` migration will ADD COLUMN it back)

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    CREATE TABLE sessions (
      id             BIGSERIAL PRIMARY KEY,
      campaign_id    BIGINT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      session_number INT NOT NULL,
      title          TEXT,
      played_at      DATE,
      recap          TEXT,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (campaign_id, session_number)
    );

    CREATE TABLE notes (
      id                 BIGSERIAL PRIMARY KEY,
      campaign_id        BIGINT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      session_id         BIGINT REFERENCES sessions(id) ON DELETE SET NULL,
      character_id       BIGINT REFERENCES characters(id) ON DELETE SET NULL, -- "about this NPC"
      author_user_id     BIGINT NOT NULL REFERENCES users(id),
      title              TEXT NOT NULL,
      body               TEXT NOT NULL,
      visible_to_players BOOLEAN NOT NULL DEFAULT false,
      created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX ON notes (campaign_id);
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    DROP TABLE IF EXISTS notes;
    DROP TABLE IF EXISTS sessions;
  `);
}

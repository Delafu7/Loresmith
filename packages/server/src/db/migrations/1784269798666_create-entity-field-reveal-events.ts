import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

// Append-only history for entity_field_reveals (Phase 1.2 of the backlog
// implementation plan). entity_field_reveals itself upserts — every toggle
// overwrites revealed_at, so there's no way to answer "when was this
// revealed the first time" or "was it ever hidden again after." This table
// is a plain INSERT-only log alongside it, written on every toggle; the
// current-state table is untouched.
//
// Shape mirrors entity_field_reveals AS IT EXISTS TODAY, not as it was
// originally designed: 1784269769666_remove-hide-reveal-except-weaknesses.ts
// dropped entity_field_reveals.character_id entirely and made
// monster_instance_id NOT NULL (reveals narrowed to monster-instance
// weaknesses only) — so this history table is monster-instance-only too,
// a plain FK rather than the dual-nullable-FK + CHECK(num_nonnulls(...)=1)
// shape the original table used back when it covered both entity types.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    CREATE TABLE entity_field_reveal_events (
      id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      monster_instance_id  UUID NOT NULL REFERENCES monster_instances(id) ON DELETE CASCADE,
      field_key            TEXT NOT NULL,
      revealed              BOOLEAN NOT NULL,
      player_override       TEXT,
      actor_user_id         UUID REFERENCES users(id),
      created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX ON entity_field_reveal_events (monster_instance_id, field_key, created_at);
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`DROP TABLE IF EXISTS entity_field_reveal_events;`);
}

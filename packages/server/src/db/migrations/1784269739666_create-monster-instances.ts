import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

// Campaign-instance: "this specific goblin in campaign #4" — HP/status live
// here, never on the `monsters` catalog row. `active_effects` (Phase 2) will
// later add a nullable FK onto this table; nothing here depends on it.

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    CREATE TABLE monster_instances (
      id              BIGSERIAL PRIMARY KEY,
      campaign_id     BIGINT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      monster_id      BIGINT NOT NULL REFERENCES monsters(id),
      custom_name     TEXT,
      hp_max_override INT,
      hp_current      INT NOT NULL,
      hp_temp         INT NOT NULL DEFAULT 0,
      status          TEXT NOT NULL DEFAULT 'alive' CHECK (status IN ('alive','dead','fled','captured')),
      is_recurring    BOOLEAN NOT NULL DEFAULT false,
      notes           TEXT,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX ON monster_instances (campaign_id);
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`DROP TABLE IF EXISTS monster_instances;`);
}

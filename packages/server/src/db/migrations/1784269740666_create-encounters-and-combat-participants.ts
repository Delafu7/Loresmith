import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

// PLAN.md's `encounters` has a `location_id BIGINT REFERENCES locations(id)`
// column, but `locations` is a Phase 3 table (excluded from Phase 1 scope).
// We drop that column entirely for now rather than leaving an unenforced
// plain BIGINT — Phase 3's migration that introduces `locations` will ADD
// COLUMN location_id back onto this table.

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    CREATE TABLE encounters (            -- a campaign can have MANY rows with status='active' at once
      id                 BIGSERIAL PRIMARY KEY,
      campaign_id        BIGINT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      name               TEXT NOT NULL,
      status             TEXT NOT NULL DEFAULT 'preparing' CHECK (status IN ('preparing','active','paused','completed')),
      current_round      INT NOT NULL DEFAULT 0,
      current_turn_index INT NOT NULL DEFAULT 0,
      sync_seq           INT NOT NULL DEFAULT 0, -- bumped in the same transaction as any mutation; WS clients detect gaps
      started_at         TIMESTAMPTZ,
      ended_at           TIMESTAMPTZ,
      created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX ON encounters (campaign_id, status);
    -- Deliberately no campaigns.active_encounter_id column — see PLAN.md §3.2.

    CREATE TABLE combat_participants (
      id                  BIGSERIAL PRIMARY KEY,
      encounter_id        BIGINT NOT NULL REFERENCES encounters(id) ON DELETE CASCADE,
      character_id        BIGINT REFERENCES characters(id) ON DELETE CASCADE,
      monster_instance_id BIGINT REFERENCES monster_instances(id) ON DELETE CASCADE,
      initiative_roll     INT NOT NULL,
      initiative_tiebreak INT,
      turn_order          INT NOT NULL,
      joined_round        INT NOT NULL DEFAULT 1,
      left_round          INT,
      hp_visibility       TEXT NOT NULL DEFAULT 'banded' CHECK (hp_visibility IN ('exact','banded','hidden')),
      created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
      CHECK (num_nonnulls(character_id, monster_instance_id) = 1)
    );
    CREATE UNIQUE INDEX ON combat_participants (encounter_id, character_id) WHERE character_id IS NOT NULL;
    CREATE UNIQUE INDEX ON combat_participants (encounter_id, monster_instance_id) WHERE monster_instance_id IS NOT NULL;
    CREATE INDEX ON combat_participants (encounter_id, turn_order);
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    DROP TABLE IF EXISTS combat_participants;
    DROP TABLE IF EXISTS encounters;
  `);
}

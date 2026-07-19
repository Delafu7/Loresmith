import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    CREATE TABLE races (
      id BIGSERIAL PRIMARY KEY,
      index_key TEXT NOT NULL,
      name TEXT NOT NULL,
      edition_scope TEXT NOT NULL CHECK (edition_scope IN ('2014','2024','both')),
      speed INT NOT NULL,
      size TEXT NOT NULL,
      ability_bonuses JSONB NOT NULL, -- meaningful for 2014; empty/null for 2024 rows (bonuses moved to background)
      traits JSONB NOT NULL,
      source TEXT,
      UNIQUE (index_key, edition_scope)
    );

    CREATE TABLE subraces (
      id BIGSERIAL PRIMARY KEY,
      race_id BIGINT NOT NULL REFERENCES races(id) ON DELETE CASCADE,
      index_key TEXT NOT NULL,
      name TEXT NOT NULL,
      ability_bonuses JSONB NOT NULL,
      traits JSONB NOT NULL,
      UNIQUE (race_id, index_key)
    );
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    DROP TABLE IF EXISTS subraces;
    DROP TABLE IF EXISTS races;
  `);
}

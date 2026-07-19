import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

// Edition-invariant catalog lookups (PLAN.md §3.2) — ability scores, skills,
// languages, alignments. These skip `edition_scope` except `languages`,
// matching the plan's note that edition-invariant tables skip the column.

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    CREATE TABLE ability_scores (
      id BIGSERIAL PRIMARY KEY, index_key TEXT NOT NULL UNIQUE, name TEXT NOT NULL, full_name TEXT NOT NULL
    );

    CREATE TABLE skills (
      id BIGSERIAL PRIMARY KEY, index_key TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
      ability_score_id BIGINT NOT NULL REFERENCES ability_scores(id)
    );

    CREATE TABLE languages (
      id BIGSERIAL PRIMARY KEY, index_key TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
      edition_scope TEXT NOT NULL DEFAULT 'both' CHECK (edition_scope IN ('2014','2024','both'))
    );

    CREATE TABLE alignments (
      id BIGSERIAL PRIMARY KEY, index_key TEXT NOT NULL UNIQUE, name TEXT NOT NULL
    );
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    DROP TABLE IF EXISTS alignments;
    DROP TABLE IF EXISTS languages;
    DROP TABLE IF EXISTS skills;
    DROP TABLE IF EXISTS ability_scores;
  `);
}

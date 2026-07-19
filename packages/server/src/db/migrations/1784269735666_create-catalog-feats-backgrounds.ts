import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

// `feats` is created (and seeded minimally — 2014 SRD has almost none) so
// that `backgrounds.granted_feat_id` has a real FK target for the 2024
// Origin-feat amendment, even though the full feat catalog is Phase 3+.

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    CREATE TABLE feats (
      id BIGSERIAL PRIMARY KEY, index_key TEXT NOT NULL, name TEXT NOT NULL,
      edition_scope TEXT NOT NULL CHECK (edition_scope IN ('2014','2024','both')),
      prerequisite TEXT,
      description TEXT NOT NULL,
      UNIQUE (index_key, edition_scope)
    );

    CREATE TABLE backgrounds (
      id BIGSERIAL PRIMARY KEY, index_key TEXT NOT NULL, name TEXT NOT NULL,
      edition_scope TEXT NOT NULL CHECK (edition_scope IN ('2014','2024','both')),
      skill_proficiency_ids BIGINT[] NOT NULL,
      ability_bonus_choices JSONB,        -- 2024 backgrounds grant ability bonuses
      granted_feat_id BIGINT REFERENCES feats(id), -- 2024 backgrounds grant an Origin feat
      description TEXT,
      UNIQUE (index_key, edition_scope)
    );
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    DROP TABLE IF EXISTS backgrounds;
    DROP TABLE IF EXISTS feats;
  `);
}

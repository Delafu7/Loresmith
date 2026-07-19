import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

// App-owned catalog: the dnd5e-srd skill has no monster stat blocks, so this
// app is the source of truth (PLAN.md §3.2 exact schema, verbatim).

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    CREATE TABLE monsters (
      id BIGSERIAL PRIMARY KEY,
      slug TEXT NOT NULL,
      name TEXT NOT NULL,
      edition_scope TEXT NOT NULL CHECK (edition_scope IN ('2014','2024','both')),
      size TEXT NOT NULL,
      creature_type TEXT NOT NULL,
      alignment TEXT,
      armor_class INT NOT NULL,
      armor_class_notes TEXT,
      hit_point_average INT NOT NULL,
      hit_dice TEXT NOT NULL,
      speed JSONB NOT NULL,
      str INT NOT NULL, dex INT NOT NULL, con INT NOT NULL,
      int INT NOT NULL, wis INT NOT NULL, cha INT NOT NULL,
      saving_throws JSONB,
      skills JSONB,
      damage_vulnerabilities TEXT[],
      damage_resistances TEXT[],
      damage_immunities TEXT[],
      condition_immunity_ids BIGINT[], -- forward reference to a future 'conditions' catalog table; unenforced (arrays can't carry FKs)
      senses TEXT,
      languages TEXT,
      challenge_rating NUMERIC(4,2) NOT NULL,
      xp_value INT NOT NULL,
      traits JSONB,
      actions JSONB NOT NULL,
      legendary_actions JSONB,
      reactions JSONB,
      source TEXT,
      UNIQUE (slug, edition_scope)
    );
    CREATE INDEX ON monsters (challenge_rating);
    CREATE INDEX ON monsters (creature_type);
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`DROP TABLE IF EXISTS monsters;`);
}

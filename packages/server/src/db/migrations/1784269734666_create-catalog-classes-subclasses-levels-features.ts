import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

// Note: classes.saving_throw_proficiency_ids is a plain BIGINT[] (Postgres
// cannot declare an FK on an array column), same as PLAN.md §3.2. Also note
// `class_multiclass_prerequisites` and `multiclass_spell_slot_table` are
// Phase 2 (multiclassing) — not created here; `classes.spellcasting_type` is
// kept now per the task brief since it's cheap to have and other columns
// don't depend on the Phase-2-only tables.

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    CREATE TABLE classes (
      id BIGSERIAL PRIMARY KEY,
      index_key TEXT NOT NULL,
      name TEXT NOT NULL,
      edition_scope TEXT NOT NULL CHECK (edition_scope IN ('2014','2024','both')),
      hit_die INT NOT NULL,
      primary_ability_id BIGINT REFERENCES ability_scores(id),
      spellcasting_type TEXT NOT NULL DEFAULT 'none'
        CHECK (spellcasting_type IN ('full','half','third','pact','none')),
      saving_throw_proficiency_ids BIGINT[] NOT NULL,
      source TEXT,
      UNIQUE (index_key, edition_scope)
    );

    CREATE TABLE subclasses (
      id BIGSERIAL PRIMARY KEY,
      class_id BIGINT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
      index_key TEXT NOT NULL,
      name TEXT NOT NULL,
      UNIQUE (class_id, index_key)
    );

    CREATE TABLE class_levels (
      id BIGSERIAL PRIMARY KEY,
      class_id BIGINT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
      level INT NOT NULL CHECK (level BETWEEN 1 AND 20),
      proficiency_bonus INT NOT NULL,
      features_unlocked JSONB,
      spell_slots JSONB, -- this class's OWN single-classing slot table; NOT used directly for multiclass characters
      UNIQUE (class_id, level)
    );

    CREATE TABLE class_features (
      id BIGSERIAL PRIMARY KEY,
      class_id BIGINT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
      subclass_id BIGINT REFERENCES subclasses(id) ON DELETE CASCADE,
      level INT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL
    );
    CREATE INDEX ON class_features (class_id, level);
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    DROP TABLE IF EXISTS class_features;
    DROP TABLE IF EXISTS class_levels;
    DROP TABLE IF EXISTS subclasses;
    DROP TABLE IF EXISTS classes;
  `);
}

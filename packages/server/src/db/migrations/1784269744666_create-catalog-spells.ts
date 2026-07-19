import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

// App-owned catalog (PLAN.md §3.2, verbatim): the dnd5e-srd skill deliberately
// ships no spell catalog (it's a rules-framework skill, not a stats
// database — see CLAUDE.md), so this app is the source of truth here, same
// treatment Phase 1 gave `monsters`. `spell_classes` is the many-to-many
// join recording which class(es)/subclass(es) can learn a given spell.

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    CREATE TABLE spells (
      id BIGSERIAL PRIMARY KEY,
      slug TEXT NOT NULL,
      name TEXT NOT NULL,
      edition_scope TEXT NOT NULL CHECK (edition_scope IN ('2014','2024','both')),
      level INT NOT NULL CHECK (level BETWEEN 0 AND 9),
      school_id BIGINT NOT NULL REFERENCES magic_schools(id),
      casting_time TEXT NOT NULL,
      range TEXT NOT NULL,
      component_v BOOLEAN NOT NULL DEFAULT false,
      component_s BOOLEAN NOT NULL DEFAULT false,
      component_m BOOLEAN NOT NULL DEFAULT false,
      material_description TEXT,
      duration TEXT NOT NULL,
      concentration BOOLEAN NOT NULL DEFAULT false,
      ritual BOOLEAN NOT NULL DEFAULT false,
      saving_throw_ability_id BIGINT REFERENCES ability_scores(id),
      attack_type TEXT CHECK (attack_type IN ('melee','ranged')),
      damage_at_level JSONB,
      description TEXT NOT NULL,
      higher_level_description TEXT,
      source TEXT,
      UNIQUE (slug, edition_scope)
    );

    CREATE TABLE spell_classes (
      spell_id BIGINT NOT NULL REFERENCES spells(id) ON DELETE CASCADE,
      class_id BIGINT REFERENCES classes(id) ON DELETE CASCADE,
      subclass_id BIGINT REFERENCES subclasses(id) ON DELETE CASCADE,
      CHECK (class_id IS NOT NULL OR subclass_id IS NOT NULL)
    );
    CREATE UNIQUE INDEX ON spell_classes (spell_id, COALESCE(class_id,-1), COALESCE(subclass_id,-1));
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    DROP TABLE IF EXISTS spell_classes;
    DROP TABLE IF EXISTS spells;
  `);
}

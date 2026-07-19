import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

// Campaign-instance additions (PLAN.md §3.2, verbatim):
//
// - `character_spells` — the known/prepared join. One row per
//   (character, spell, granting class) so a multiclass caster's spell list
//   is tracked per class, not merged into one undifferentiated list.
// - `character_items` — the owned/equipped instance of an `items` catalog
//   template, per §3.1 ("`items` is the template ... `character_items` is
//   the owned/equipped instance"). Attaches to a character OR a monster
//   instance (dual nullable FK + CHECK, per §3.3's tradeoff #3), never both.
// - `character_resource_pools` — generic countable resource tracking
//   (ki points, rage uses, spell slots). Spell-slot rows here are a
//   COMPUTED CACHE for multiclass characters (derived via
//   `multiclass_spell_slot_table`), not the source of truth — recomputed by
//   the app layer whenever `character_classes` changes.

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    CREATE TABLE character_spells (
      id BIGSERIAL PRIMARY KEY,
      character_id BIGINT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
      spell_id     BIGINT NOT NULL REFERENCES spells(id),
      class_id     BIGINT REFERENCES classes(id),
      is_prepared  BOOLEAN NOT NULL DEFAULT false,
      always_prepared BOOLEAN NOT NULL DEFAULT false,
      source       TEXT NOT NULL DEFAULT 'class' CHECK (source IN ('class','race','feat','item')),
      UNIQUE (character_id, spell_id, class_id)
    );

    CREATE TABLE character_items (
      id                  BIGSERIAL PRIMARY KEY,
      character_id        BIGINT REFERENCES characters(id) ON DELETE CASCADE,
      monster_instance_id BIGINT REFERENCES monster_instances(id) ON DELETE CASCADE,
      item_id             BIGINT NOT NULL REFERENCES items(id),
      quantity            INT NOT NULL DEFAULT 1,
      is_equipped         BOOLEAN NOT NULL DEFAULT false,
      is_attuned          BOOLEAN NOT NULL DEFAULT false,
      custom_name         TEXT,
      charges_remaining   INT,
      notes               TEXT,
      acquired_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
      CHECK (num_nonnulls(character_id, monster_instance_id) = 1)
    );
    CREATE INDEX ON character_items (character_id);
    CREATE INDEX ON character_items (monster_instance_id);

    CREATE TABLE character_resource_pools (
      id            BIGSERIAL PRIMARY KEY,
      character_id  BIGINT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
      resource_key  TEXT NOT NULL,
      current_value INT NOT NULL,
      max_value     INT NOT NULL,
      recharge_on   TEXT NOT NULL CHECK (recharge_on IN ('short_rest','long_rest','dawn','none')),
      UNIQUE (character_id, resource_key)
    );
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    DROP TABLE IF EXISTS character_resource_pools;
    DROP TABLE IF EXISTS character_items;
    DROP TABLE IF EXISTS character_spells;
  `);
}

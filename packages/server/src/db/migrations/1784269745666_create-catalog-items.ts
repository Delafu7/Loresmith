import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

// App-owned catalog (PLAN.md §3.2, verbatim): no equipment catalog in the
// dnd5e-srd skill, so this app is the source of truth — same treatment as
// `spells` and `monsters`. `items` is the template (damage die, weight,
// rarity); `character_items` (later Phase 2 migration) is the owned/equipped
// instance, per the catalog/instance split in §3.1.

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    CREATE TABLE items (
      id BIGSERIAL PRIMARY KEY,
      slug TEXT NOT NULL,
      name TEXT NOT NULL,
      edition_scope TEXT NOT NULL CHECK (edition_scope IN ('2014','2024','both')),
      item_type TEXT NOT NULL CHECK (item_type IN
        ('weapon','armor','shield','tool','adventuring_gear','magic_item','consumable','mount','vehicle')),
      rarity TEXT NOT NULL DEFAULT 'mundane' CHECK (rarity IN
        ('mundane','common','uncommon','rare','very_rare','legendary','artifact')),
      weight_lb NUMERIC(6,2),
      cost_cp INT,
      armor_class_base INT,
      armor_class_formula TEXT,
      damage_dice TEXT,
      damage_type_id BIGINT REFERENCES damage_types(id),
      requires_attunement BOOLEAN NOT NULL DEFAULT false,
      properties JSONB,
      description TEXT,
      source TEXT,
      UNIQUE (slug, edition_scope)
    );
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`DROP TABLE IF EXISTS items;`);
}

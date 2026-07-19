import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

// Phase 3.5: armor/equipment AC system with an auto/manual toggle (PLAN.md
// §3.5/§5.7). items.armor_class_base/armor_class_formula already exist
// (Phase 2) but were write-only (seeded, never read) — these new structured
// columns REPLACE the informal properties.category/str_requirement/
// stealth_disadvantage keys used ad hoc in seed data, and become what
// services/armorClass.ts's computeArmorClass actually reads;
// armor_class_formula stays as a legacy display-only string.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`ALTER TABLE items ADD COLUMN armor_category TEXT CHECK (armor_category IN ('light','medium','heavy'));`);
  pgm.sql(`ALTER TABLE items ADD COLUMN dex_modifier_rule TEXT CHECK (dex_modifier_rule IN ('full','max_2','none'));`);
  pgm.sql(`ALTER TABLE items ADD COLUMN str_requirement INT;`);
  pgm.sql(`ALTER TABLE items ADD COLUMN stealth_disadvantage BOOLEAN NOT NULL DEFAULT false;`);

  // Defaulting to 'manual' is the key "don't change existing behavior"
  // guarantee: every character keeps today's flat manually-edited AC until
  // someone explicitly opts into 'auto' via PATCH /characters/:id/armor-class-mode.
  pgm.sql(`
    ALTER TABLE characters ADD COLUMN armor_class_mode TEXT NOT NULL DEFAULT 'manual'
      CHECK (armor_class_mode IN ('auto','manual'));
  `);

  // Manual escape hatch for creature instances, mirroring hp_max_override's
  // existing pattern exactly — monster_instances never gets an auto-recompute
  // path (see services/armorClass.ts's top-of-file scope note): monster AC is
  // either the catalog monsters.armor_class value or this flat override.
  pgm.sql(`ALTER TABLE monster_instances ADD COLUMN armor_class_override INT;`);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`ALTER TABLE monster_instances DROP COLUMN IF EXISTS armor_class_override;`);
  pgm.sql(`ALTER TABLE characters DROP COLUMN IF EXISTS armor_class_mode;`);
  pgm.sql(`ALTER TABLE items DROP COLUMN IF EXISTS stealth_disadvantage;`);
  pgm.sql(`ALTER TABLE items DROP COLUMN IF EXISTS str_requirement;`);
  pgm.sql(`ALTER TABLE items DROP COLUMN IF EXISTS dex_modifier_rule;`);
  pgm.sql(`ALTER TABLE items DROP COLUMN IF EXISTS armor_category;`);
}

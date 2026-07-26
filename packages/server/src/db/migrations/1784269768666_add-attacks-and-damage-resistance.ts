import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

// REFACTOR-PLAN.md §6 / docs/rules/attacks-and-damage.md §2.
//
// character_attacks: a real table (not JSONB, unlike monsters' catalog
// actions) — a PC's attack list mutates often in play, and each row needs a
// stable id for the new apply-damage endpoint to reference (an audit trail
// of "this HP change came from attack row N"). Instance data (one specific
// PC's build), same tier as character_spells/character_items, per this
// app's existing catalog-vs-instance convention — not campaign-shared
// catalog data like monsters.actions.
//
// characters.damage_resistances/vulnerabilities/immunities: mirrors
// monsters' existing three TEXT[] columns exactly. Real SRD PC/NPC
// resistance sources exist in both editions (a Dwarf's poison resistance,
// a Barbarian's Rage resistances) and characters had zero columns for any
// of the three before this. These are PERMANENT/build-derived sources only
// — temporary/conditional resistance (Rage while raging) is deliberately
// NOT modeled here; see OPEN_QUESTIONS.md for why that's a documented
// follow-up rather than done in this pass.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    ALTER TABLE characters ADD COLUMN damage_resistances TEXT[] NOT NULL DEFAULT '{}';
    ALTER TABLE characters ADD COLUMN damage_vulnerabilities TEXT[] NOT NULL DEFAULT '{}';
    ALTER TABLE characters ADD COLUMN damage_immunities TEXT[] NOT NULL DEFAULT '{}';

    CREATE TABLE character_attacks (
      id                 BIGSERIAL PRIMARY KEY,
      character_id       BIGINT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
      name               TEXT NOT NULL,
      attack_bonus       INT,
      damage_dice        TEXT,
      damage_type        TEXT,
      save_dc            INT,
      save_ability_index TEXT,
      half_on_save       BOOLEAN NOT NULL DEFAULT true,
      notes              TEXT,
      sort_order         INT NOT NULL DEFAULT 0,
      created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
      CHECK (NOT (attack_bonus IS NOT NULL AND save_dc IS NOT NULL))
    );
    CREATE INDEX ON character_attacks (character_id, sort_order);
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    DROP TABLE character_attacks;
    ALTER TABLE characters DROP COLUMN damage_immunities;
    ALTER TABLE characters DROP COLUMN damage_vulnerabilities;
    ALTER TABLE characters DROP COLUMN damage_resistances;
  `);
}

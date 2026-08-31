import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

// docs/roadmap/dnd-2024-gap-analysis.md P1-6 (EQ-02) — Weapon Mastery
// mechanical effects. Three pieces of schema this phase needs, none of
// which existed before:
//
// 1. `character_attacks.item_id` — a PC's attack row previously had no link
//    to any catalog weapon at all (freeform name/damage_dice/damage_type),
//    so nothing could ever know which mastery property (if any) an attack
//    uses. Nullable — spell attacks, monster-flavor attacks, and homebrew
//    entries with no catalog weapon behind them keep item_id null.
//
// 2. `class_levels.weapon_mastery_count` — how many kinds of weapon a
//    character can use the mastery property of, at this class+level. Only
//    5 of 12 classes ever populate this (see db/seeds/catalog.ts's
//    seedWeaponMasteryCounts); the rest stay NULL, which is the correct
//    "this class never gets Weapon Mastery" answer, not a gap.
//
// 3. `character_weapon_mastery_choices` — the actual "which weapon kinds
//    has this character chosen" instance data (PHB: "Whenever you finish a
//    Long Rest, you can practice weapon drills and change one of those
//    weapon choices" — a player choice, not derived from anything else).
//    One row per (character, item) — a character either knows a given
//    weapon's mastery or doesn't; no separate ordering/slot concept needed.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    ALTER TABLE character_attacks ADD COLUMN item_id UUID REFERENCES items(id);
    ALTER TABLE class_levels ADD COLUMN weapon_mastery_count SMALLINT;

    CREATE TABLE character_weapon_mastery_choices (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      character_id UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
      item_id UUID NOT NULL REFERENCES items(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (character_id, item_id)
    );
    CREATE INDEX ON character_weapon_mastery_choices (character_id);
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    DROP TABLE IF EXISTS character_weapon_mastery_choices;
    ALTER TABLE class_levels DROP COLUMN IF EXISTS weapon_mastery_count;
    ALTER TABLE character_attacks DROP COLUMN IF EXISTS item_id;
  `);
}

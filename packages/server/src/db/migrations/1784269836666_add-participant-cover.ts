// docs/roadmap/dnd-2024-gap-analysis.md P1-10 (CB-... cover) — this
// project's own verified rules reference (.claude/skills/dnd-2024-rules/
// references/combat.md line 48, rules-glossary.md line 40) confirms: Half
// Cover +2 AC/Dex saves, Three-Quarters +5 AC/Dex saves, Total can't be
// targeted at all; only the best applicable degree ever applies. One column
// per participant (not a set of cover sources) matches that "best degree
// only" rule directly — the DM sets whichever single degree currently
// applies, same "one small DM knob" shape as combat_participants.faction.
//
// This app has no server-side attack hit/miss resolution to hang
// enforcement off of (see docs/roadmap/progress.md's P1-10 entry for the
// scope decision) — `cover` is tracked state the DM sets, surfaced via
// getEncounterCombatSnapshot as a computed armor_class_effective / cover-
// blocks-targeting flag for the DM/players to use when adjudicating, the
// same "suggest a value, never server-enforced" precedent as
// diceEngine.ts's computeSaveDc.

import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    ALTER TABLE combat_participants ADD COLUMN cover TEXT NOT NULL DEFAULT 'none'
      CHECK (cover IN ('none','half','three_quarters','total'));
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    ALTER TABLE combat_participants DROP COLUMN IF EXISTS cover;
  `);
}

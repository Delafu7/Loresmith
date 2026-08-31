// docs/roadmap/dnd-2024-gap-analysis.md P1-9 (CB-04) — Surprise.
//
// One column, deliberately: `is_surprised`. Everything mechanical it drives
// is edition-branched in services/encounters.ts (this project's own
// verified rules reference, .claude/skills/dnd-2024-rules/references/
// combat.md and 2014-vs-2024-differences.md, confirms the 2014 and 2024
// PHBs genuinely disagree here — 2014: "you can't move or take an action on
// your first turn of combat, and you can't take a reaction until that turn
// ends"; 2024: the *sole* effect is Disadvantage on the Initiative roll, no
// action lockout at all):
//   - 2014: is_surprised gates action/movement/reaction spends
//     (applyActionEconomy) until the participant's own first turn ends, at
//     which point advanceTurn clears the flag.
//   - 2024: is_surprised only changes HOW that participant's Initiative
//     roll is made (2d20 keep-lower instead of 1d20) — set at the same
//     "start combat" action that performs that roll, then left alone
//     (harmless: 2024 never re-reads it after the roll settles, and keeping
//     it true is a useful post-hoc "who was surprised" record for the DM).
//
// No separate "surprised" catalog/effect_definitions row: Surprise isn't in
// either edition's formal Conditions list (it's combat-start-only special
// text in the same PHB chapter, not a mechanic active_effects' condition
// catalog covers), so a plain boolean column matches its actual scope
// better than routing it through the conditions system built for Prone/
// Restrained/etc.

import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    ALTER TABLE combat_participants ADD COLUMN is_surprised BOOLEAN NOT NULL DEFAULT false;
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    ALTER TABLE combat_participants DROP COLUMN IF EXISTS is_surprised;
  `);
}

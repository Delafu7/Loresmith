import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

// Iteration 3 dice-engine rebuild (docs/rules/dice-mechanics.md §1.2) —
// characters.ts's/monsters.ts's applyDamage both insert a row into
// dice_rolls for a critical hit with dice_count already silently doubled,
// but nothing on the row records that a doubling happened: a viewer of
// roll history can't distinguish "this was a critical hit" from "the
// player manually rolled 2d8 for some other reason." Display/audit fix
// only — nothing currently lets a client lie about isCritical to get free
// extra dice server-side (the doubling is driven by the server-derived
// isCritical value, see services/diceRolls.ts's
// deriveIsCriticalFromAttackRoll), so this is not a security fix.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`ALTER TABLE dice_rolls ADD COLUMN is_critical BOOLEAN NOT NULL DEFAULT false;`);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`ALTER TABLE dice_rolls DROP COLUMN is_critical;`);
}

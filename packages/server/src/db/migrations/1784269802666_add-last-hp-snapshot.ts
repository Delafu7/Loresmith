import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

// Phase 2 "HP/damage undo" — same idea as combat_participants.last_action_
// economy_snapshot (1784269784666-ish, undoActionEconomy's own snapshot),
// but placed on characters/monster_instances instead of combat_participants:
// HP itself lives on those two tables, not on combat_participants (which
// only ever COALESCEs it in for the combat snapshot read), and
// applyDamage/applyMonsterInstanceDamage aren't encounter-scoped calls in
// the first place — a character can take damage outside any live encounter,
// same "not necessarily encounter-scoped" pattern this app already uses for
// dice rolls/resource pools. The plan's own sketch for this located the
// column on combat_participants; this deviates from that sketch to match
// where the restorable data actually lives.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    ALTER TABLE characters ADD COLUMN last_hp_snapshot JSONB;
    ALTER TABLE monster_instances ADD COLUMN last_hp_snapshot JSONB;
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    ALTER TABLE monster_instances DROP COLUMN last_hp_snapshot;
    ALTER TABLE characters DROP COLUMN last_hp_snapshot;
  `);
}

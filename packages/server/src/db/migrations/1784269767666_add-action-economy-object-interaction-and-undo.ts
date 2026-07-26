import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

// REFACTOR-PLAN.md §5 / docs/rules/actions.md §2.3-2.4.
//
// object_interaction_used: a fourth per-turn tracked resource, distinct from
// the action/bonus-action/reaction slots (docs/rules/actions.md §1.6 — "one
// free object interaction per turn" is not part of the action economy in
// either SRD edition). Reset alongside the other four *_used columns in
// advanceTurn.
//
// last_action_economy_snapshot: the smallest mechanism that satisfies
// REFACTOR-PLAN.md §5's "allow the DM to undo" ask (a single-slot "undo the
// last mutation" snapshot, not a log table/stack — docs/rules/actions.md
// §2.4's explicit recommendation). Overwritten on every applyActionEconomy
// call with the PRE-mutation values of whatever columns that call is about
// to change; consumed (and nulled) by a single undo call. Nullable JSONB
// since its shape varies by which columns a given spend touched (e.g. a
// Dash spend snapshots dash_used AND movement_used_ft together, a plain
// action spend snapshots only action_used).
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    ALTER TABLE combat_participants ADD COLUMN object_interaction_used BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE combat_participants ADD COLUMN last_action_economy_snapshot JSONB;
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    ALTER TABLE combat_participants DROP COLUMN last_action_economy_snapshot;
    ALTER TABLE combat_participants DROP COLUMN object_interaction_used;
  `);
}

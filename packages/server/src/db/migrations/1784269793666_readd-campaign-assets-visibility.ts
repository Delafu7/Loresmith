import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

// campaign_assets.visible_to_players was dropped by
// 1784269769666_remove-hide-reveal-except-weaknesses.ts along with the rest
// of the general-purpose "hide info from players" engine ("the feature is
// gone, not archived"). This is a second, narrow, explicit exception to that
// decision — user-requested per-image visibility for the campaign asset
// library and the bestiary image gallery built on top of it (Iteration 4) —
// mirroring 1784269792666_add-dice-roll-visibility-and-requests.ts's own
// precedent for dice rolls. Scoped to campaign_assets only; every other
// table that migration touched (notes, dice_rolls' now-superseded plain
// column, active_effects, combat_participants) stays exactly as removed.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    ALTER TABLE campaign_assets ADD COLUMN visible_to_players BOOLEAN NOT NULL DEFAULT true;
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    ALTER TABLE campaign_assets DROP COLUMN visible_to_players;
  `);
}

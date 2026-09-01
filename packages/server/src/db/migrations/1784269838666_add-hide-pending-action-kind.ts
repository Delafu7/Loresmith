import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

// docs/roadmap/dnd-2024-gap-analysis.md P1-13 — the Hide action needs a
// pending_action_requests.kind value of its own (mirrors shove/grapple's
// own PC-attacker-only, DM-approval-gated shape). Constraint name confirmed
// against the live dev DB via pg_get_constraintdef (auto-named by Postgres,
// no explicit name given in 1784269828666_create-pending-action-requests.ts).
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    ALTER TABLE pending_action_requests DROP CONSTRAINT pending_action_requests_kind_check;
  `);
  pgm.sql(`
    ALTER TABLE pending_action_requests ADD CONSTRAINT pending_action_requests_kind_check
      CHECK (kind IN ('attack_character','attack_monster','cast','shove','grapple','hide'));
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    ALTER TABLE pending_action_requests DROP CONSTRAINT pending_action_requests_kind_check;
  `);
  pgm.sql(`
    ALTER TABLE pending_action_requests ADD CONSTRAINT pending_action_requests_kind_check
      CHECK (kind IN ('attack_character','attack_monster','cast','shove','grapple'));
  `);
}

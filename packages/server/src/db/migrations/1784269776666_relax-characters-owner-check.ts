import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

// Campaign import must be able to create PCs with no owning player at all
// (never auto-bound to the importing DM) so a real player can later claim
// them by email — but characters_check (1784269737666_create-characters.ts,
// re-added by the UUID migration) currently forbids that exact state:
// `CHECK (NOT is_pc OR owner_user_id IS NOT NULL)`. The rest of the codebase
// already treats a null owner_user_id gracefully regardless of is_pc —
// requireOwnerOrDm (services/authz.ts) reads null as "only the DM may act on
// this," and dashboard/socket-room code already null-checks it — so dropping
// this constraint doesn't require touching any of that, only the places that
// currently rely on the constraint to guarantee a PC always has an owner
// (campaignImport.ts, characters.ts's createCharacter), which are updated in
// the same change as this migration.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`ALTER TABLE characters DROP CONSTRAINT characters_check;`);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  // Reversible only if no unassigned PC rows exist by the time this runs —
  // same acceptable-to-fail-on-real-data precedent as other CHECK-tightening
  // down() migrations in this codebase.
  pgm.sql(`ALTER TABLE characters ADD CONSTRAINT characters_check CHECK (NOT is_pc OR owner_user_id IS NOT NULL);`);
}

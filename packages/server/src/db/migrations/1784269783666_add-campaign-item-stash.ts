import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

// Global item repository (nav point 5) — `character_items` previously
// required EXACTLY one of character_id/monster_instance_id (the "owned/
// equipped instance" model). This adds a third owner kind: a campaign-owned,
// not-yet-assigned stash item (e.g. loot the DM has imported from the
// catalog but hasn't handed to a player yet). Per PLAN.md's own tradeoff
// note on this table (§3.3), a row still belongs to exactly one owner —
// campaign_id just widens the set of valid owners from two to three, rather
// than loosening the invariant to "zero or more". "Give to character"
// (services/campaignItems.ts) is a plain UPDATE moving a row from the
// campaign_id owner to the character_id owner, preserving the row's id/
// quantity/custom_name/etc. — not a delete+recreate.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    ALTER TABLE character_items ADD COLUMN campaign_id UUID REFERENCES campaigns(id) ON DELETE CASCADE;
    CREATE INDEX ON character_items (campaign_id);

    ALTER TABLE character_items DROP CONSTRAINT character_items_check;
    ALTER TABLE character_items ADD CONSTRAINT character_items_check
      CHECK (num_nonnulls(character_id, monster_instance_id, campaign_id) = 1);
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    ALTER TABLE character_items DROP CONSTRAINT character_items_check;
    DELETE FROM character_items WHERE campaign_id IS NOT NULL;
    ALTER TABLE character_items DROP COLUMN campaign_id;
    ALTER TABLE character_items ADD CONSTRAINT character_items_check
      CHECK (num_nonnulls(character_id, monster_instance_id) = 1);
  `);
}

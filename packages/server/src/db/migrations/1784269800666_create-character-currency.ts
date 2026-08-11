import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

// Phase 1.5 of the backlog implementation plan — currency was entirely
// missing from the data model (the audit found no gp/sp/cp tracking
// anywhere). 1:1 with characters (PK = FK), NOT 1:many like every sibling
// table (character_items, character_spells, character_resource_pools) — a
// character has exactly one purse, not a list of purses. No row is created
// at character-creation time; services/characterCurrency.ts upserts on
// first write and treats a missing row as all-zero on read, so this stays
// fully independent of the character-creation transaction.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    CREATE TABLE character_currency (
      character_id UUID PRIMARY KEY REFERENCES characters(id) ON DELETE CASCADE,
      cp INT NOT NULL DEFAULT 0,
      sp INT NOT NULL DEFAULT 0,
      ep INT NOT NULL DEFAULT 0,
      gp INT NOT NULL DEFAULT 0,
      pp INT NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`DROP TABLE IF EXISTS character_currency;`);
}

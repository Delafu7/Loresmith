import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

// Phase 3 "NPC 'what they want' field" — DM prep tool: a one-line (or
// short-paragraph) note on what motivates this NPC, entirely independent of
// is_pc (a PC could theoretically get one too, though the UI only offers it
// for NPCs). DM-only, same visibility as gm_notes — see redactGmNotes
// (services/characters.ts), extended to also strip this field rather than
// adding a second near-identical redaction helper.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`ALTER TABLE characters ADD COLUMN npc_motivation TEXT;`);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`ALTER TABLE characters DROP COLUMN npc_motivation;`);
}

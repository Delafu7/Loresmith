import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

// docs/roadmap/dnd-2024-gap-analysis.md P1-4 (FT-01) — the 2024 PHB
// categorizes every feat as exactly one of Origin/General/Fighting Style/
// Epic Boon (docs/players-handbook-2024/Chapter 5- Feats), a distinction
// this table never captured (only index_key/name/edition_scope/prerequisite/
// description existed). Nullable: 2014's minimal feat set (this app's seed
// carries just Grappler) predates this categorization entirely and isn't
// forced into one of the four 2024 buckets; homebrew feats are free to
// leave it unset too.

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    ALTER TABLE feats ADD COLUMN type TEXT CHECK (type IN ('origin', 'general', 'fighting_style', 'epic_boon'));
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`ALTER TABLE feats DROP COLUMN IF EXISTS type;`);
}

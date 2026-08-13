import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

// Compendium feature, Phase 5: persists feat selection made during character
// creation (previously nowhere to store it — feats/catalog.ts was
// read-only). Minimal join shape, mirrors character_skill_proficiencies'
// (character_id, X) composite-PK pattern rather than inventing a richer
// shape — a feat is either granted or it isn't, no per-feat metadata needed
// yet. granted_at is purely informational (when it was added to the sheet),
// not consulted by any rule.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    CREATE TABLE character_feats (
      character_id UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
      feat_id UUID NOT NULL REFERENCES feats(id) ON DELETE CASCADE,
      granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (character_id, feat_id)
    );
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`DROP TABLE IF EXISTS character_feats;`);
}

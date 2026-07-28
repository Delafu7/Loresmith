import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

// Phase 1 ("Adapt the App"): extends the homebrew-scoping pattern already
// proven by monsters (1784269753666_add-monster-homebrew-scope.ts) and
// effect_definitions to every remaining catalog table — items, spells,
// races, subraces, classes, subclasses, backgrounds, feats, alignments,
// languages, damage_types. Same shape every time: a global row has
// is_homebrew=false and owning_campaign_id=NULL and is immutable outside
// this migration; a homebrew row belongs to exactly one campaign and is
// fully DM-editable there. created_at/updated_at are added too — these
// tables never had them (rarely-mutated reference data), but a DM-authored
// row is no longer "rarely mutated reference data," it's content someone
// is actively creating and iterating on.
export async function up(pgm: MigrationBuilder): Promise<void> {
  const tables = [
    'items', 'spells', 'races', 'subraces', 'classes', 'subclasses',
    'backgrounds', 'feats', 'alignments', 'languages', 'damage_types',
  ];
  for (const t of tables) {
    pgm.sql(`
      ALTER TABLE ${t} ADD COLUMN is_homebrew BOOLEAN NOT NULL DEFAULT false;
      ALTER TABLE ${t} ADD COLUMN owning_campaign_id UUID REFERENCES campaigns(id) ON DELETE CASCADE;
      ALTER TABLE ${t} ADD CONSTRAINT ${t}_homebrew_scope CHECK (is_homebrew OR owning_campaign_id IS NULL);
      ALTER TABLE ${t} ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT now();
      ALTER TABLE ${t} ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
      CREATE INDEX ON ${t} (owning_campaign_id);
    `);
  }
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  const tables = [
    'items', 'spells', 'races', 'subraces', 'classes', 'subclasses',
    'backgrounds', 'feats', 'alignments', 'languages', 'damage_types',
  ];
  for (const t of tables) {
    pgm.sql(`
      ALTER TABLE ${t} DROP CONSTRAINT ${t}_homebrew_scope;
      ALTER TABLE ${t} DROP COLUMN is_homebrew;
      ALTER TABLE ${t} DROP COLUMN owning_campaign_id;
      ALTER TABLE ${t} DROP COLUMN created_at;
      ALTER TABLE ${t} DROP COLUMN updated_at;
    `);
  }
}

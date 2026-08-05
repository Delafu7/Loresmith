import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

// Campaign bestiary curation: "this campaign knows about goblins, and the DM
// has renamed this one's the Goblin Warlord and given it 20 extra HP." This
// is a THIRD concept, distinct from both `monsters` (the global/homebrew
// catalog template) and `monster_instances` (a live combat copy with
// hp_current/status). A bestiary entry never touches either — it's a
// campaign-scoped reference to a catalog row plus DM-authored overrides and
// a player-visibility flag. No FK to monster_instances in either direction:
// adding/removing a creature from the campaign bestiary must never affect
// combat spawning (today's MonstersPage.tsx flow keeps working unchanged),
// and spawning a combat instance must never require a bestiary entry to
// exist first.
//
// stat_overrides is a single JSONB blob (shallow-merged over the catalog
// row at read time by services/campaignBestiary.ts), not one override
// column per stat-block field — `monsters` has ~30 such columns and mirroring
// monster_instances' named-override pattern (hp_max_override, etc.) here
// would mean constant migration churn as DMs ask to override more fields.
// Validated server-side against schemas/monsterCatalog.ts's
// updateHomebrewMonsterSchema, reused rather than duplicated.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    CREATE TABLE campaign_bestiary_entries (
      id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      campaign_id      UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      monster_id       UUID NOT NULL REFERENCES monsters(id) ON DELETE CASCADE,
      custom_name      TEXT,
      stat_overrides   JSONB NOT NULL DEFAULT '{}'::jsonb,
      notes            TEXT,
      discovered       BOOLEAN NOT NULL DEFAULT false,
      added_by_user_id UUID REFERENCES users(id),
      created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (campaign_id, monster_id)
    );
    CREATE INDEX ON campaign_bestiary_entries (campaign_id);
    CREATE INDEX ON campaign_bestiary_entries (monster_id);
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`DROP TABLE IF EXISTS campaign_bestiary_entries;`);
}

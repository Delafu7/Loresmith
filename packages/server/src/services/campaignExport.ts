// Phase 4: JSON campaign export — DM-only snapshot of a campaign's "core
// content": characters (with every sub-resource), notes, session log, the
// campaign's own homebrew catalog rows (all 12 catalogHomebrew.ts tables),
// homebrew monsters, and asset metadata. Deliberately EXCLUDES ephemeral/
// live state — dice_rolls history, combat_participants/active_effects (live
// encounter state), encounter_maps — none of which make sense to "restore"
// into a new campaign. See services/campaignImport.ts for the inverse
// operation.
//
// Nested under /campaigns/:id/..., so (per PLAN.md §4.3's layering) auth is
// entirely the route's requireCampaignMember()+requireRole('dm') middleware
// — this function trusts it's only ever called for an authorized DM, same
// as listSessionLogs/createSessionLog etc. in services/campaigns.ts.
//
// Rows are exported close to raw (SELECT * minus the _legacy migration
// remnants), keeping their ORIGINAL ids so cross-references within the
// export (e.g. a character's raceId pointing at a row in
// homebrewCatalog.races) stay resolvable — campaignImport.ts is the one that
// decides which of those ids get remapped to freshly-generated ones.

import type { Pool } from 'pg';
import { notFound } from '../middleware/errors.js';

export const CAMPAIGN_EXPORT_FORMAT_VERSION = 1;

type Row = Record<string, unknown>;

function stripLegacy(row: Row): Row {
  const out: Row = {};
  for (const [col, val] of Object.entries(row)) {
    if (!col.endsWith('_legacy')) out[col] = val;
  }
  return out;
}

async function rows(pool: Pool, sql: string, values: unknown[]): Promise<Row[]> {
  const result = await pool.query(sql, values);
  return result.rows.map(stripLegacy);
}

// Matches routes/catalogHomebrew.ts's ENTITIES table list exactly (the 11
// tables from the catalog-homebrew-scope migration, plus effect_definitions).
const HOMEBREW_CATALOG_TABLES = [
  'alignments', 'languages', 'damage_types', 'feats',
  'races', 'subraces', 'classes', 'subclasses', 'backgrounds', 'items', 'spells',
  'effect_definitions',
] as const;

export async function exportCampaign(pool: Pool, campaignId: string) {
  const campaignRes = await pool.query(`SELECT * FROM campaigns WHERE id = $1`, [campaignId]);
  const campaign = campaignRes.rows[0];
  if (!campaign) throw notFound('Campaign');

  const assets = await rows(pool, `SELECT * FROM campaign_assets WHERE campaign_id = $1 ORDER BY created_at ASC`, [campaignId]);

  const homebrewCatalog: Record<string, Row[]> = {};
  for (const table of HOMEBREW_CATALOG_TABLES) {
    homebrewCatalog[table] = await rows(
      pool,
      `SELECT * FROM ${table} WHERE is_homebrew AND owning_campaign_id = $1 ORDER BY name ASC`,
      [campaignId],
    );
  }

  const monsters = await rows(
    pool,
    `SELECT * FROM monsters WHERE is_homebrew AND owning_campaign_id = $1 ORDER BY name ASC`,
    [campaignId],
  );

  const characterRows = await rows(pool, `SELECT * FROM characters WHERE campaign_id = $1 ORDER BY name ASC`, [campaignId]);
  const characters: Row[] = [];
  for (const character of characterRows) {
    const characterId = character.id as string;
    characters.push({
      ...character,
      classes: await rows(pool, `SELECT * FROM character_classes WHERE character_id = $1`, [characterId]),
      items: await rows(pool, `SELECT * FROM character_items WHERE character_id = $1`, [characterId]),
      attacks: await rows(pool, `SELECT * FROM character_attacks WHERE character_id = $1 ORDER BY sort_order ASC`, [characterId]),
      spells: await rows(pool, `SELECT * FROM character_spells WHERE character_id = $1`, [characterId]),
      savingThrowProficiencies: await rows(
        pool,
        `SELECT * FROM character_saving_throw_proficiencies WHERE character_id = $1`,
        [characterId],
      ),
      skillProficiencies: await rows(pool, `SELECT * FROM character_skill_proficiencies WHERE character_id = $1`, [characterId]),
      resourcePools: await rows(pool, `SELECT * FROM character_resource_pools WHERE character_id = $1`, [characterId]),
    });
  }

  const sessionLog = await rows(pool, `SELECT * FROM sessions WHERE campaign_id = $1 ORDER BY session_number ASC`, [campaignId]);
  const notes = await rows(pool, `SELECT * FROM notes WHERE campaign_id = $1 ORDER BY created_at ASC`, [campaignId]);

  return {
    formatVersion: CAMPAIGN_EXPORT_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    campaign,
    assets,
    homebrewCatalog,
    monsters,
    characters,
    sessionLog,
    notes,
  };
}

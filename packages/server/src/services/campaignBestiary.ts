// Per-campaign bestiary curation (Task 1) — "this campaign knows about
// goblins, and the DM renamed this one." A campaign_bestiary_entries row is
// a reference to a `monsters` catalog row plus DM-authored overrides and a
// player-visibility flag. Deliberately independent of monster_instances
// (services/monsters.ts, the combat-spawn path) — no FK either direction,
// see the migration's header comment for why. Campaign membership/role
// checks are the caller's responsibility (route-level requireCampaignMember/
// requireRole), same convention as services/monsterCatalog.ts; this file
// enforces resource scoping (a row must belong to the campaign it's read/
// written through) and the player-visibility filter.

import type { Pool } from 'pg';
import { notFound } from '../middleware/errors.js';
import type { CampaignRole } from './authz.js';
import type { UpdateBestiaryEntryInput } from '../schemas/campaignBestiary.js';
import * as campaignCategoriesService from './campaignCategories.js';

const ENTITY_TYPE = 'creature';

interface BestiaryEntryRow {
  id: string;
  campaign_id: string;
  monster_id: string;
  custom_name: string | null;
  stat_overrides: Record<string, unknown>;
  notes: string | null;
  discovered: boolean;
  added_by_user_id: string | null;
  created_at: string;
  updated_at: string;
}

interface BestiaryEntryWithMonsterRow extends BestiaryEntryRow {
  monster: Record<string, unknown>;
}

// Mechanical camelCase -> snake_case, mirrors routes/catalogHomebrew.ts's
// toSnakeCaseColumns — exact here for the same reason (every monsters
// column is plain snake_case with no unusual abbreviations).
function toSnakeCaseColumns(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;
    out[key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)] = value;
  }
  return out;
}

function toDto(row: BestiaryEntryWithMonsterRow, categories: campaignCategoriesService.CampaignCategory[]) {
  return {
    id: row.id,
    campaign_id: row.campaign_id,
    monster_id: row.monster_id,
    custom_name: row.custom_name,
    stat_overrides: row.stat_overrides,
    notes: row.notes,
    discovered: row.discovered,
    added_by_user_id: row.added_by_user_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
    categories,
    monster: row.monster,
    effective: { ...row.monster, ...row.stat_overrides },
  };
}

async function fetchEntryWithMonsterOrThrow(pool: Pool, campaignId: string, entryId: string): Promise<BestiaryEntryWithMonsterRow> {
  const result = await pool.query<BestiaryEntryWithMonsterRow>(
    `SELECT cbe.*, row_to_json(m.*) AS monster
     FROM campaign_bestiary_entries cbe
     JOIN monsters m ON m.id = cbe.monster_id
     WHERE cbe.id = $1 AND cbe.campaign_id = $2`,
    [entryId, campaignId],
  );
  const row = result.rows[0];
  if (!row) throw notFound('Bestiary entry');
  return row;
}

export async function listCampaignBestiary(pool: Pool, campaignId: string, role: CampaignRole) {
  const values: unknown[] = [campaignId];
  let where = 'cbe.campaign_id = $1';
  // Player visibility is enforced here, in the WHERE clause, not by
  // filtering the result in JS — an undiscovered row must never leave the
  // database for a player-role request.
  if (role !== 'dm') where += ' AND cbe.discovered = true';

  const result = await pool.query<BestiaryEntryWithMonsterRow>(
    `SELECT cbe.*, row_to_json(m.*) AS monster
     FROM campaign_bestiary_entries cbe
     JOIN monsters m ON m.id = cbe.monster_id
     WHERE ${where}
     ORDER BY COALESCE(cbe.custom_name, m.name) ASC`,
    values,
  );

  const categoriesByEntity = await campaignCategoriesService.listCategoriesForEntities(pool, ENTITY_TYPE, result.rows.map((r) => r.id));
  return result.rows.map((row) => toDto(row, categoriesByEntity.get(row.id) ?? []));
}

export async function getCampaignBestiaryEntry(pool: Pool, campaignId: string, entryId: string, role: CampaignRole) {
  const row = await fetchEntryWithMonsterOrThrow(pool, campaignId, entryId);
  // Same "don't confirm existence" discipline as the reveal engine and
  // catalogHomebrew's owned-row fetch: a player hitting an undiscovered
  // entry's id gets NOT_FOUND, never FORBIDDEN.
  if (role !== 'dm' && !row.discovered) throw notFound('Bestiary entry');

  const categoriesByEntity = await campaignCategoriesService.listCategoriesForEntities(pool, ENTITY_TYPE, [row.id]);
  return toDto(row, categoriesByEntity.get(row.id) ?? []);
}

export interface AddToCampaignBestiaryResult {
  added: unknown[];
  alreadyAdded: string[];
}

export async function addToCampaignBestiary(
  pool: Pool,
  campaignId: string,
  actorUserId: string,
  monsterIds: string[],
): Promise<AddToCampaignBestiaryResult> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Every requested monster must be global, this campaign's own homebrew,
    // OR (Iteration 2 "Shared bestiary") the calling user's own library
    // homebrew — never another campaign's campaign-scoped homebrew (that
    // tier is deliberately kept non-shared, the "named villain" case). Same
    // posture as fetchHomebrewMonsterOrThrow: 404, not 403, so this never
    // confirms another campaign's or another user's homebrew creature exists.
    const monstersRes = await client.query<{ id: string; owning_campaign_id: string | null; owning_user_id: string | null }>(
      `SELECT id, owning_campaign_id, owning_user_id FROM monsters WHERE id = ANY($1::uuid[])`,
      [monsterIds],
    );
    const found = new Map(monstersRes.rows.map((r) => [r.id, r]));
    for (const id of monsterIds) {
      const monster = found.get(id);
      const isGlobal = monster && monster.owning_campaign_id === null && monster.owning_user_id === null;
      const isOwnCampaignHomebrew = monster && monster.owning_campaign_id === campaignId;
      const isOwnUserLibrary = monster && monster.owning_user_id === actorUserId;
      if (!monster || !(isGlobal || isOwnCampaignHomebrew || isOwnUserLibrary)) {
        throw notFound('Monster');
      }
    }

    const insertRes = await client.query<{ monster_id: string }>(
      `INSERT INTO campaign_bestiary_entries (campaign_id, monster_id, added_by_user_id)
       SELECT $1, mid, $2 FROM UNNEST($3::uuid[]) AS mid
       ON CONFLICT (campaign_id, monster_id) DO NOTHING
       RETURNING *`,
      [campaignId, actorUserId, monsterIds],
    );

    await client.query('COMMIT');

    const addedIds = new Set(insertRes.rows.map((r) => r.monster_id));
    return {
      added: insertRes.rows,
      alreadyAdded: monsterIds.filter((id) => !addedIds.has(id)),
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function updateCampaignBestiaryEntry(
  pool: Pool,
  campaignId: string,
  entryId: string,
  input: UpdateBestiaryEntryInput,
) {
  const existing = await fetchEntryWithMonsterOrThrow(pool, campaignId, entryId);

  const sets: string[] = [];
  const values: unknown[] = [];
  let i = 1;
  if (input.customName !== undefined) {
    sets.push(`custom_name = $${i++}`);
    values.push(input.customName);
  }
  if (input.notes !== undefined) {
    sets.push(`notes = $${i++}`);
    values.push(input.notes);
  }
  if (input.discovered !== undefined) {
    sets.push(`discovered = $${i++}`);
    values.push(input.discovered);
  }
  if (input.statOverrides !== undefined) {
    // Shallow-merged into the EXISTING overrides blob (not replaced) — a
    // PATCH that only supplies a new armorClass override must not clobber
    // an hpMaxOverride set by an earlier PATCH.
    const merged = { ...existing.stat_overrides, ...toSnakeCaseColumns(input.statOverrides) };
    sets.push(`stat_overrides = $${i++}`);
    values.push(JSON.stringify(merged));
  }

  if (sets.length > 0) {
    sets.push('updated_at = now()');
    values.push(entryId, campaignId);
    await pool.query(
      `UPDATE campaign_bestiary_entries SET ${sets.join(', ')} WHERE id = $${i} AND campaign_id = $${i + 1}`,
      values,
    );
  }

  return getCampaignBestiaryEntry(pool, campaignId, entryId, 'dm');
}

export async function removeCampaignBestiaryEntry(pool: Pool, campaignId: string, entryId: string): Promise<void> {
  const result = await pool.query(`DELETE FROM campaign_bestiary_entries WHERE id = $1 AND campaign_id = $2`, [entryId, campaignId]);
  if (result.rowCount === 0) throw notFound('Bestiary entry');
}

// Bulk sibling of the single-entry delete above (Iteration 2 "Shared
// bestiary" — unassociating several shared templates from a campaign at
// once). Silently ignores entryIds that don't belong to this campaign
// (already-removed or never-existed), same "no-op on unknown ids" posture
// as addToCampaignBestiary's ON CONFLICT DO NOTHING, rather than 404ing the
// whole batch over one stale id.
export async function removeCampaignBestiaryEntries(pool: Pool, campaignId: string, entryIds: string[]): Promise<{ removed: number }> {
  const result = await pool.query(
    `DELETE FROM campaign_bestiary_entries WHERE campaign_id = $1 AND id = ANY($2::uuid[])`,
    [campaignId, entryIds],
  );
  return { removed: result.rowCount ?? 0 };
}

export { ENTITY_TYPE as BESTIARY_ENTITY_TYPE };

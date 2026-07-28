// Generic CRUD + duplicate for the 11 catalog tables that got homebrew
// scoping in the catalog-homebrew-scope migration (items, spells, races,
// subraces, classes, subclasses, backgrounds, feats, alignments, languages,
// damage_types) — same is_homebrew/owning_campaign_id shape monsters and
// effect_definitions already established, generalized here instead of
// copy-pasted 11 times, since the actual CRUD mechanics (insert with a
// randomized key suffix to dodge the global unique constraint, update only
// if owned, delete only if owned, duplicate any row into your own campaign)
// are identical across all of them — only the column list differs, and that
// comes from the caller as plain data, not by branching on table name here.

import type { Pool } from 'pg';
import { AppError, notFound } from '../middleware/errors.js';
import { requireDm, requireMembership } from './authz.js';

export interface CatalogTableConfig {
  table: string;
  // The column holding the human-editable "slug" — `slug` for items/spells,
  // `index_key` for everything else (PLAN.md §3.2's SRD-derived naming).
  keyColumn: 'slug' | 'index_key';
}

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 8);
}

/**
 * Inserts a new homebrew row scoped to `campaignId`. `values` is a plain
 * snake_case column -> value map for every writable column except
 * id/is_homebrew/owning_campaign_id/created_at/updated_at, which this
 * fills in itself. The key column's value gets a random suffix appended —
 * same collision-avoidance the monster catalog already uses, since the
 * global unique index on (keyColumn[, edition_scope]) doesn't know or care
 * that this row is homebrew.
 */
export async function createHomebrewCatalogRow(
  pool: Pool,
  actorId: string,
  campaignId: string,
  config: CatalogTableConfig,
  values: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const role = await requireMembership(pool, campaignId, actorId);
  requireDm(role);

  const keyValue = values[config.keyColumn];
  if (typeof keyValue !== 'string' || keyValue.length === 0) {
    throw new AppError('VALIDATION_ERROR', `${config.keyColumn} is required`);
  }
  const scopedValues = { ...values, [config.keyColumn]: `${keyValue}-${randomSuffix()}` };

  const columns = Object.keys(scopedValues);
  const placeholders = columns.map((_, i) => `$${i + 1}`);
  const result = await pool.query(
    `INSERT INTO ${config.table} (${columns.join(', ')}, is_homebrew, owning_campaign_id)
     VALUES (${placeholders.join(', ')}, true, $${columns.length + 1})
     RETURNING *`,
    [...columns.map((c) => scopedValues[c]), campaignId],
  );
  return result.rows[0];
}

async function fetchOwnedRowOrThrow(
  pool: Pool,
  actorId: string,
  campaignId: string,
  config: CatalogTableConfig,
  id: string,
): Promise<Record<string, unknown>> {
  const role = await requireMembership(pool, campaignId, actorId);
  requireDm(role);

  const result = await pool.query(`SELECT * FROM ${config.table} WHERE id = $1`, [id]);
  const row = result.rows[0];
  if (!row) throw notFound('Entry');
  if (!row.is_homebrew || row.owning_campaign_id !== campaignId) {
    // Same "global rows stay immutable via this path regardless of role"
    // rule as monsters — a global row (or another campaign's homebrew row)
    // simply isn't reachable through the write path at all, reported as
    // 404 rather than 403 so it doesn't confirm the row's existence/scope
    // to a non-owner.
    throw notFound('Entry');
  }
  return row;
}

export async function updateHomebrewCatalogRow(
  pool: Pool,
  actorId: string,
  campaignId: string,
  config: CatalogTableConfig,
  id: string,
  values: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  await fetchOwnedRowOrThrow(pool, actorId, campaignId, config, id);

  const columns = Object.keys(values).filter((c) => values[c] !== undefined);
  if (columns.length === 0) {
    const current = await pool.query(`SELECT * FROM ${config.table} WHERE id = $1`, [id]);
    return current.rows[0];
  }
  const sets = columns.map((c, i) => `${c} = $${i + 1}`);
  const result = await pool.query(
    `UPDATE ${config.table} SET ${sets.join(', ')}, updated_at = now() WHERE id = $${columns.length + 1} RETURNING *`,
    [...columns.map((c) => values[c]), id],
  );
  return result.rows[0];
}

export async function deleteHomebrewCatalogRow(
  pool: Pool,
  actorId: string,
  campaignId: string,
  config: CatalogTableConfig,
  id: string,
): Promise<void> {
  await fetchOwnedRowOrThrow(pool, actorId, campaignId, config, id);
  await pool.query(`DELETE FROM ${config.table} WHERE id = $1`, [id]);
}

/**
 * Duplicates ANY row (global or homebrew, from any campaign) into a new
 * homebrew row owned by `campaignId` — the one operation that makes
 * "official content is editable starting data" true without ever mutating
 * the shared global row in place: a DM who wants to tweak an SRD item
 * duplicates it into their campaign first, then edits their own copy.
 * `excludeColumns` drops columns that must never be copied verbatim (id,
 * is_homebrew, owning_campaign_id, created_at, updated_at, and the key
 * column itself, which createHomebrewCatalogRow re-suffixes anyway).
 */
export async function duplicateCatalogRow(
  pool: Pool,
  actorId: string,
  campaignId: string,
  config: CatalogTableConfig,
  sourceId: string,
): Promise<Record<string, unknown>> {
  const role = await requireMembership(pool, campaignId, actorId);
  requireDm(role);

  const sourceRes = await pool.query(`SELECT * FROM ${config.table} WHERE id = $1`, [sourceId]);
  const source = sourceRes.rows[0];
  if (!source) throw notFound('Entry');

  const omit = new Set(['id', 'is_homebrew', 'owning_campaign_id', 'created_at', 'updated_at', 'id_legacy']);
  const values: Record<string, unknown> = {};
  for (const [col, val] of Object.entries(source)) {
    if (!omit.has(col) && !col.endsWith('_legacy')) values[col] = val;
  }
  values[config.keyColumn] = `${String(source[config.keyColumn])}-copy`;

  return createHomebrewCatalogRow(pool, actorId, campaignId, config, values);
}

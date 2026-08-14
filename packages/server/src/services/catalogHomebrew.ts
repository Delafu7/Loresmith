// Generic CRUD + duplicate for the 13 catalog tables plugged into the
// generic homebrew system (the 11 covered by the catalog-homebrew-scope
// migration, plus effect_definitions and conditions) — same is_homebrew/
// owning_campaign_id/owning_user_id shape monsters already established,
// generalized here instead of copy-pasted N times, since the actual CRUD
// mechanics (insert with a randomized key suffix to dodge the global unique
// constraint, update only if owned, delete only if owned, duplicate any row
// into your own scope) are identical across all of them — only the column
// list differs, and that comes from the caller as plain data, not by
// branching on table name here.
//
// Every write function takes a CatalogOwnerScope instead of a bare
// campaignId: a row is authored either inside a campaign (DM-authored,
// visible to that campaign only) or in a user's personal compendium
// (visible to every campaign that user runs), mirroring the two-axis
// ownership monsters proved out first (1784269789666_add-monster-library-
// scope.ts). Exactly one function per CRUD verb handles both — the branch is
// on scope.kind, never on entity type.

import type { Pool } from 'pg';
import { AppError, notFound } from '../middleware/errors.js';
import { requireDm, requireMembership } from './authz.js';

export interface CatalogTableConfig {
  table: string;
  // The column holding the human-editable "slug" — `slug` for items/spells,
  // `index_key` for everything else (PLAN.md §3.2's SRD-derived naming).
  // `null` for tables with no such column and no matching UNIQUE constraint
  // at all (e.g. effect_definitions) — the suffix-append below exists only
  // to dodge that constraint, so it's simply skipped when there isn't one.
  keyColumn: 'slug' | 'index_key' | null;
  // jsonb columns on this table (e.g. races.traits, items.properties). `pg`
  // only auto-serializes a plain JS *object* param into jsonb correctly — a
  // plain JS *array* param (traits is `jsonb` holding an array of trait
  // objects) gets bound as a Postgres ARRAY literal instead and the insert
  // fails with "invalid input syntax for type json". Explicitly
  // JSON.stringify-ing every column named here sidesteps that regardless of
  // whether the value underneath happens to be an object or an array.
  jsonbColumns?: Set<string>;
}

// A homebrew row is authored in exactly one of these two places at a time —
// never both (the widened <table>_homebrew_scope CHECK enforces this in the
// database too). 'campaign' is the original, unchanged behavior; 'user' is
// the new personal-compendium axis.
export type CatalogOwnerScope =
  | { kind: 'campaign'; campaignId: string; actorId: string }
  | { kind: 'user'; userId: string };

function serializeJsonbColumns(config: CatalogTableConfig, values: Record<string, unknown>): Record<string, unknown> {
  if (!config.jsonbColumns || config.jsonbColumns.size === 0) return values;
  const out: Record<string, unknown> = { ...values };
  for (const col of config.jsonbColumns) {
    if (col in out && out[col] !== null && out[col] !== undefined) out[col] = JSON.stringify(out[col]);
  }
  return out;
}

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 8);
}

// Membership/role checks only apply to the 'campaign' scope — a personal
// compendium row has no campaign to be a member of; ownership (owning_user_id
// = the caller) is the entire authorization check, same as
// fetchUserLibraryMonsterOrThrow in services/monsterCatalog.ts.
async function requireWriteAccess(pool: Pool, scope: CatalogOwnerScope): Promise<void> {
  if (scope.kind === 'campaign') {
    const role = await requireMembership(pool, scope.campaignId, scope.actorId);
    requireDm(role);
  }
}

/**
 * Inserts a new homebrew row scoped per `scope`. `values` is a plain
 * snake_case column -> value map for every writable column except
 * id/is_homebrew/owning_campaign_id/owning_user_id/created_at/updated_at,
 * which this fills in itself. The key column's value gets a random suffix
 * appended — same collision-avoidance the monster catalog already uses,
 * since the global unique index on (keyColumn[, edition_scope]) doesn't know
 * or care that this row is homebrew.
 */
export async function createHomebrewCatalogRow(
  pool: Pool,
  scope: CatalogOwnerScope,
  config: CatalogTableConfig,
  values: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  await requireWriteAccess(pool, scope);

  let scopedValues = serializeJsonbColumns(config, values);
  if (config.keyColumn !== null) {
    const keyValue = values[config.keyColumn];
    if (typeof keyValue !== 'string' || keyValue.length === 0) {
      throw new AppError('VALIDATION_ERROR', `${config.keyColumn} is required`);
    }
    scopedValues = { ...scopedValues, [config.keyColumn]: `${keyValue}-${randomSuffix()}` };
  }

  const columns = Object.keys(scopedValues);
  const placeholders = columns.map((_, i) => `$${i + 1}`);
  const owningCampaignId = scope.kind === 'campaign' ? scope.campaignId : null;
  const owningUserId = scope.kind === 'user' ? scope.userId : null;
  const result = await pool.query(
    `INSERT INTO ${config.table} (${columns.join(', ')}, is_homebrew, owning_campaign_id, owning_user_id)
     VALUES (${placeholders.join(', ')}, true, $${columns.length + 1}, $${columns.length + 2})
     RETURNING *`,
    [...columns.map((c) => scopedValues[c]), owningCampaignId, owningUserId],
  );
  return result.rows[0];
}

async function fetchOwnedRowOrThrow(
  pool: Pool,
  scope: CatalogOwnerScope,
  config: CatalogTableConfig,
  id: string,
): Promise<Record<string, unknown>> {
  await requireWriteAccess(pool, scope);

  const result = await pool.query(`SELECT * FROM ${config.table} WHERE id = $1`, [id]);
  const row = result.rows[0];
  const owned = row?.is_homebrew && (
    scope.kind === 'campaign' ? row.owning_campaign_id === scope.campaignId : row.owning_user_id === scope.userId
  );
  if (!row || !owned) {
    // Same "global rows (and rows scoped elsewhere) stay unreachable via
    // this path regardless of role" rule as monsters — reported as 404
    // rather than 403 so it doesn't confirm the row's existence/scope to a
    // non-owner.
    throw notFound('Entry');
  }
  return row;
}

export async function updateHomebrewCatalogRow(
  pool: Pool,
  scope: CatalogOwnerScope,
  config: CatalogTableConfig,
  id: string,
  values: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  await fetchOwnedRowOrThrow(pool, scope, config, id);

  const scopedValues = serializeJsonbColumns(config, values);
  const columns = Object.keys(scopedValues).filter((c) => scopedValues[c] !== undefined);
  if (columns.length === 0) {
    const current = await pool.query(`SELECT * FROM ${config.table} WHERE id = $1`, [id]);
    return current.rows[0];
  }
  const sets = columns.map((c, i) => `${c} = $${i + 1}`);
  const result = await pool.query(
    `UPDATE ${config.table} SET ${sets.join(', ')}, updated_at = now() WHERE id = $${columns.length + 1} RETURNING *`,
    [...columns.map((c) => scopedValues[c]), id],
  );
  return result.rows[0];
}

export async function deleteHomebrewCatalogRow(
  pool: Pool,
  scope: CatalogOwnerScope,
  config: CatalogTableConfig,
  id: string,
): Promise<void> {
  await fetchOwnedRowOrThrow(pool, scope, config, id);
  await pool.query(`DELETE FROM ${config.table} WHERE id = $1`, [id]);
}

/**
 * Duplicates ANY row (global, or homebrew from any campaign/personal
 * library) into a new homebrew row owned per `scope` — the one operation
 * that makes "official content is editable starting data" true without ever
 * mutating the shared global row in place: authoring a tweak to an SRD item
 * means duplicating it into your own scope first, then editing your own
 * copy. `omit` drops columns that must never be copied verbatim (id,
 * is_homebrew, owning_campaign_id, owning_user_id, created_at, updated_at,
 * and the key column itself, which createHomebrewCatalogRow re-suffixes
 * anyway).
 */
export async function duplicateCatalogRow(
  pool: Pool,
  scope: CatalogOwnerScope,
  config: CatalogTableConfig,
  sourceId: string,
): Promise<Record<string, unknown>> {
  await requireWriteAccess(pool, scope);

  const sourceRes = await pool.query(`SELECT * FROM ${config.table} WHERE id = $1`, [sourceId]);
  const source = sourceRes.rows[0];
  if (!source) throw notFound('Entry');

  const omit = new Set(['id', 'is_homebrew', 'owning_campaign_id', 'owning_user_id', 'created_at', 'updated_at', 'id_legacy']);
  const values: Record<string, unknown> = {};
  for (const [col, val] of Object.entries(source)) {
    if (!omit.has(col) && !col.endsWith('_legacy')) values[col] = val;
  }
  // No key column to re-suffix (e.g. effect_definitions) — copy every field
  // verbatim; createHomebrewCatalogRow won't append anything either.
  if (config.keyColumn !== null) {
    values[config.keyColumn] = `${String(source[config.keyColumn])}-copy`;
  }

  return createHomebrewCatalogRow(pool, scope, config, values);
}

// ---- Library scope conversion (promote / assign) ----
//
// In-place scope changes on the SAME row (not a copy — that's
// duplicateCatalogRow above), mirroring
// promoteHomebrewMonsterToLibrary/assignHomebrewMonsterToCampaign in
// services/monsterCatalog.ts. None of these 13 tables has a cross-scope
// curation join table analogous to campaign_bestiary_entries, so — unlike
// the monster version — there's no "still referenced by another campaign"
// guard needed here.

/**
 * Moves a row from campaign homebrew into the acting DM's personal
 * compendium — reusable across every campaign they run afterward. Must
 * currently be owned by THIS campaign specifically (strict check, not an OR
 * across scopes), so promoting a row the actor already owns in their
 * compendium is a clean 404 rather than a confusing no-op.
 */
export async function promoteCatalogRowToLibrary(
  pool: Pool,
  campaignId: string,
  actorUserId: string,
  config: CatalogTableConfig,
  id: string,
): Promise<Record<string, unknown>> {
  const role = await requireMembership(pool, campaignId, actorUserId);
  requireDm(role);

  const result = await pool.query(
    `UPDATE ${config.table} SET owning_campaign_id = NULL, owning_user_id = $1, updated_at = now()
     WHERE id = $2 AND owning_campaign_id = $3
     RETURNING *`,
    [actorUserId, id, campaignId],
  );
  if (!result.rows[0]) throw notFound('Entry');
  return result.rows[0];
}

/**
 * Moves a row from the acting user's personal compendium into a specific
 * campaign's homebrew — the campaign must be one the actor DMs, and the row
 * must currently be in that actor's own compendium.
 */
export async function assignCatalogRowToCampaign(
  pool: Pool,
  campaignId: string,
  actorUserId: string,
  config: CatalogTableConfig,
  id: string,
): Promise<Record<string, unknown>> {
  const role = await requireMembership(pool, campaignId, actorUserId);
  requireDm(role);

  const result = await pool.query(
    `UPDATE ${config.table} SET owning_user_id = NULL, owning_campaign_id = $1, updated_at = now()
     WHERE id = $2 AND owning_user_id = $3
     RETURNING *`,
    [campaignId, id, actorUserId],
  );
  if (!result.rows[0]) throw notFound('Entry');
  return result.rows[0];
}

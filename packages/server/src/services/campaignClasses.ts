// Per-campaign class curation — mirrors services/campaignRaces.ts exactly,
// swapped to the `classes` catalog table. See that file's header comment for
// the full rationale (two-tier duality with catalogHomebrew.ts's fork
// mechanism; characters reference classes.id directly via
// character_classes.class_id, never a campaign_class_entries id).

import type { Pool } from 'pg';
import { notFound } from '../middleware/errors.js';
import type { UpdateCampaignClassEntryInput } from '../schemas/campaignClasses.js';

interface ClassEntryRow {
  id: string;
  campaign_id: string;
  class_id: string;
  custom_name: string | null;
  overrides: Record<string, unknown>;
  notes: string | null;
  added_by_user_id: string | null;
  created_at: string;
  updated_at: string;
}

interface ClassEntryWithClassRow extends ClassEntryRow {
  class: Record<string, unknown>;
}

function toSnakeCaseColumns(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;
    out[key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)] = value;
  }
  return out;
}

function toDto(row: ClassEntryWithClassRow) {
  return {
    id: row.id,
    campaign_id: row.campaign_id,
    class_id: row.class_id,
    custom_name: row.custom_name,
    overrides: row.overrides,
    notes: row.notes,
    added_by_user_id: row.added_by_user_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
    class: row.class,
    effective: { ...row.class, ...row.overrides },
  };
}

async function fetchEntryWithClassOrThrow(pool: Pool, campaignId: string, entryId: string): Promise<ClassEntryWithClassRow> {
  const result = await pool.query<ClassEntryWithClassRow>(
    `SELECT cce.*, row_to_json(c.*) AS class
     FROM campaign_class_entries cce
     JOIN classes c ON c.id = cce.class_id
     WHERE cce.id = $1 AND cce.campaign_id = $2`,
    [entryId, campaignId],
  );
  const row = result.rows[0];
  if (!row) throw notFound('Class entry');
  return row;
}

export async function listCampaignClasses(pool: Pool, campaignId: string) {
  const result = await pool.query<ClassEntryWithClassRow>(
    `SELECT cce.*, row_to_json(c.*) AS class
     FROM campaign_class_entries cce
     JOIN classes c ON c.id = cce.class_id
     WHERE cce.campaign_id = $1
     ORDER BY COALESCE(cce.custom_name, c.name) ASC`,
    [campaignId],
  );
  return result.rows.map(toDto);
}

export async function getCampaignClassEntry(pool: Pool, campaignId: string, entryId: string) {
  const row = await fetchEntryWithClassOrThrow(pool, campaignId, entryId);
  return toDto(row);
}

export interface AddToCampaignClassesResult {
  added: unknown[];
  alreadyAdded: string[];
}

export async function addToCampaignClasses(
  pool: Pool,
  campaignId: string,
  actorUserId: string,
  classIds: string[],
): Promise<AddToCampaignClassesResult> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const classesRes = await client.query<{ id: string; owning_campaign_id: string | null; owning_user_id: string | null }>(
      `SELECT id, owning_campaign_id, owning_user_id FROM classes WHERE id = ANY($1::uuid[])`,
      [classIds],
    );
    const found = new Map(classesRes.rows.map((r) => [r.id, r]));
    for (const id of classIds) {
      const cls = found.get(id);
      const isGlobal = cls && cls.owning_campaign_id === null && cls.owning_user_id === null;
      const isOwnCampaignHomebrew = cls && cls.owning_campaign_id === campaignId;
      const isOwnUserLibrary = cls && cls.owning_user_id === actorUserId;
      if (!cls || !(isGlobal || isOwnCampaignHomebrew || isOwnUserLibrary)) {
        throw notFound('Class');
      }
    }

    const insertRes = await client.query<{ class_id: string }>(
      `INSERT INTO campaign_class_entries (campaign_id, class_id, added_by_user_id)
       SELECT $1, cid, $2 FROM UNNEST($3::uuid[]) AS cid
       ON CONFLICT (campaign_id, class_id) DO NOTHING
       RETURNING *`,
      [campaignId, actorUserId, classIds],
    );

    await client.query('COMMIT');

    const addedIds = new Set(insertRes.rows.map((r) => r.class_id));
    return {
      added: insertRes.rows,
      alreadyAdded: classIds.filter((id) => !addedIds.has(id)),
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function updateCampaignClassEntry(
  pool: Pool,
  campaignId: string,
  entryId: string,
  input: UpdateCampaignClassEntryInput,
) {
  const existing = await fetchEntryWithClassOrThrow(pool, campaignId, entryId);

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
  if (input.overrides !== undefined || input.clearOverrides !== undefined) {
    const merged: Record<string, unknown> = { ...existing.overrides, ...toSnakeCaseColumns(input.overrides ?? {}) };
    for (const key of input.clearOverrides ?? []) {
      delete merged[key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)];
    }
    sets.push(`overrides = $${i++}`);
    values.push(JSON.stringify(merged));
  }

  if (sets.length > 0) {
    sets.push('updated_at = now()');
    values.push(entryId, campaignId);
    await pool.query(
      `UPDATE campaign_class_entries SET ${sets.join(', ')} WHERE id = $${i} AND campaign_id = $${i + 1}`,
      values,
    );
  }

  return getCampaignClassEntry(pool, campaignId, entryId);
}

export async function removeCampaignClassEntry(pool: Pool, campaignId: string, entryId: string): Promise<void> {
  const result = await pool.query(`DELETE FROM campaign_class_entries WHERE id = $1 AND campaign_id = $2`, [entryId, campaignId]);
  if (result.rowCount === 0) throw notFound('Class entry');
}

export async function removeCampaignClassEntries(pool: Pool, campaignId: string, entryIds: string[]): Promise<{ removed: number }> {
  const result = await pool.query(
    `DELETE FROM campaign_class_entries WHERE campaign_id = $1 AND id = ANY($2::uuid[])`,
    [campaignId, entryIds],
  );
  return { removed: result.rowCount ?? 0 };
}

// Per-campaign race curation — "this campaign has imported the High Elf, and
// the DM tweaked its traits." A campaign_race_entries row is a reference to a
// `races` catalog row plus DM-authored overrides. Distinct from that catalog
// row's own homebrew-fork mechanism (services/catalogHomebrew.ts's
// duplicateCatalogRow, which copies a row into a new campaign-owned catalog
// row) — same two-tier duality campaign_bestiary_entries already established
// for monsters. Characters reference races.id directly (see
// characters.race_id), never a campaign_race_entries id, so importing/
// removing an entry here never affects any character that already picked
// that race. Campaign membership/role checks are the caller's responsibility
// (route-level requireCampaignMember/requireRole), same convention as
// services/campaignBestiary.ts.

import type { Pool } from 'pg';
import { notFound } from '../middleware/errors.js';
import type { UpdateCampaignRaceEntryInput } from '../schemas/campaignRaces.js';

interface RaceEntryRow {
  id: string;
  campaign_id: string;
  race_id: string;
  custom_name: string | null;
  overrides: Record<string, unknown>;
  notes: string | null;
  added_by_user_id: string | null;
  created_at: string;
  updated_at: string;
}

interface RaceEntryWithRaceRow extends RaceEntryRow {
  race: Record<string, unknown>;
}

// Mechanical camelCase -> snake_case, mirrors services/campaignBestiary.ts's
// toSnakeCaseColumns.
function toSnakeCaseColumns(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;
    out[key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)] = value;
  }
  return out;
}

function toDto(row: RaceEntryWithRaceRow) {
  return {
    id: row.id,
    campaign_id: row.campaign_id,
    race_id: row.race_id,
    custom_name: row.custom_name,
    overrides: row.overrides,
    notes: row.notes,
    added_by_user_id: row.added_by_user_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
    race: row.race,
    effective: { ...row.race, ...row.overrides },
  };
}

async function fetchEntryWithRaceOrThrow(pool: Pool, campaignId: string, entryId: string): Promise<RaceEntryWithRaceRow> {
  const result = await pool.query<RaceEntryWithRaceRow>(
    `SELECT cre.*, row_to_json(r.*) AS race
     FROM campaign_race_entries cre
     JOIN races r ON r.id = cre.race_id
     WHERE cre.id = $1 AND cre.campaign_id = $2`,
    [entryId, campaignId],
  );
  const row = result.rows[0];
  if (!row) throw notFound('Race entry');
  return row;
}

export async function listCampaignRaces(pool: Pool, campaignId: string) {
  const result = await pool.query<RaceEntryWithRaceRow>(
    `SELECT cre.*, row_to_json(r.*) AS race
     FROM campaign_race_entries cre
     JOIN races r ON r.id = cre.race_id
     WHERE cre.campaign_id = $1
     ORDER BY COALESCE(cre.custom_name, r.name) ASC`,
    [campaignId],
  );
  return result.rows.map(toDto);
}

export async function getCampaignRaceEntry(pool: Pool, campaignId: string, entryId: string) {
  const row = await fetchEntryWithRaceOrThrow(pool, campaignId, entryId);
  return toDto(row);
}

export interface AddToCampaignRacesResult {
  added: unknown[];
  alreadyAdded: string[];
}

export async function addToCampaignRaces(
  pool: Pool,
  campaignId: string,
  actorUserId: string,
  raceIds: string[],
): Promise<AddToCampaignRacesResult> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Every requested race must be global, this campaign's own homebrew, or
    // the calling user's own personal-library homebrew — never another
    // campaign's campaign-scoped homebrew. Same posture as
    // campaignBestiary.ts's addToCampaignBestiary: 404, not 403, so this
    // never confirms another campaign's or another user's homebrew race
    // exists.
    const racesRes = await client.query<{ id: string; owning_campaign_id: string | null; owning_user_id: string | null }>(
      `SELECT id, owning_campaign_id, owning_user_id FROM races WHERE id = ANY($1::uuid[])`,
      [raceIds],
    );
    const found = new Map(racesRes.rows.map((r) => [r.id, r]));
    for (const id of raceIds) {
      const race = found.get(id);
      const isGlobal = race && race.owning_campaign_id === null && race.owning_user_id === null;
      const isOwnCampaignHomebrew = race && race.owning_campaign_id === campaignId;
      const isOwnUserLibrary = race && race.owning_user_id === actorUserId;
      if (!race || !(isGlobal || isOwnCampaignHomebrew || isOwnUserLibrary)) {
        throw notFound('Race');
      }
    }

    const insertRes = await client.query<{ race_id: string }>(
      `INSERT INTO campaign_race_entries (campaign_id, race_id, added_by_user_id)
       SELECT $1, rid, $2 FROM UNNEST($3::uuid[]) AS rid
       ON CONFLICT (campaign_id, race_id) DO NOTHING
       RETURNING *`,
      [campaignId, actorUserId, raceIds],
    );

    await client.query('COMMIT');

    const addedIds = new Set(insertRes.rows.map((r) => r.race_id));
    return {
      added: insertRes.rows,
      alreadyAdded: raceIds.filter((id) => !addedIds.has(id)),
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function updateCampaignRaceEntry(
  pool: Pool,
  campaignId: string,
  entryId: string,
  input: UpdateCampaignRaceEntryInput,
) {
  const existing = await fetchEntryWithRaceOrThrow(pool, campaignId, entryId);

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
    // Shallow-merged into the EXISTING overrides blob, same as
    // campaignBestiary.ts's updateCampaignBestiaryEntry.
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
      `UPDATE campaign_race_entries SET ${sets.join(', ')} WHERE id = $${i} AND campaign_id = $${i + 1}`,
      values,
    );
  }

  return getCampaignRaceEntry(pool, campaignId, entryId);
}

export async function removeCampaignRaceEntry(pool: Pool, campaignId: string, entryId: string): Promise<void> {
  const result = await pool.query(`DELETE FROM campaign_race_entries WHERE id = $1 AND campaign_id = $2`, [entryId, campaignId]);
  if (result.rowCount === 0) throw notFound('Race entry');
}

export async function removeCampaignRaceEntries(pool: Pool, campaignId: string, entryIds: string[]): Promise<{ removed: number }> {
  const result = await pool.query(
    `DELETE FROM campaign_race_entries WHERE campaign_id = $1 AND id = ANY($2::uuid[])`,
    [campaignId, entryIds],
  );
  return { removed: result.rowCount ?? 0 };
}

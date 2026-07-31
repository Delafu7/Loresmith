// Campaign item stash — character_items rows owned by a campaign (campaign_id
// set, character_id/monster_instance_id both null; see the
// add-campaign-item-stash migration) rather than by a specific character.
// This is the "campaign-owned, not-yet-assigned item instance" from PLAN.md
// §5: importing a catalog item creates one of these; "give to character"
// moves it onto a character by UPDATEing character_id/campaign_id in place,
// preserving the row's id/quantity/custom_name/etc.
//
// Every route here is mounted under /campaigns/:id/item-stash with
// requireCampaignMember + requireRole('dm') middleware already applied
// (routes/campaignItems.ts), matching campaignMonsterInstancesRouter's
// division of labor — membership/role is the route layer's job, not
// re-checked here. The one authz question a route-level check CAN'T answer
// is "does the target character belong to THIS campaign", which
// giveStashItemToCharacter checks itself before moving anything.

import type { Pool } from 'pg';
import { notFound } from '../middleware/errors.js';
import { fetchCharacterOrThrow } from './characters.js';
import type { ImportCampaignStashItemInput, UpdateCampaignStashItemInput } from '../schemas/campaignItems.js';

export async function listCampaignStashItems(pool: Pool, campaignId: string) {
  const result = await pool.query(
    `SELECT * FROM character_items WHERE campaign_id = $1 ORDER BY acquired_at ASC`,
    [campaignId],
  );
  return result.rows;
}

export async function importCampaignStashItem(pool: Pool, campaignId: string, input: ImportCampaignStashItemInput) {
  const result = await pool.query(
    `INSERT INTO character_items (campaign_id, item_id, quantity, custom_name, charges_remaining, notes)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [campaignId, input.itemId, input.quantity, input.customName ?? null, input.chargesRemaining ?? null, input.notes ?? null],
  );
  return result.rows[0];
}

const UPDATABLE_COLUMNS: Record<string, string> = {
  quantity: 'quantity',
  customName: 'custom_name',
  chargesRemaining: 'charges_remaining',
  notes: 'notes',
};

export async function updateCampaignStashItem(
  pool: Pool,
  campaignId: string,
  stashItemId: string,
  input: UpdateCampaignStashItemInput,
) {
  const sets: string[] = [];
  const values: unknown[] = [];
  let i = 1;
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;
    const column = UPDATABLE_COLUMNS[key];
    if (!column) continue;
    sets.push(`${column} = $${i++}`);
    values.push(value);
  }
  if (sets.length === 0) {
    const existing = await pool.query(
      `SELECT * FROM character_items WHERE id = $1 AND campaign_id = $2`,
      [stashItemId, campaignId],
    );
    const row = existing.rows[0];
    if (!row) throw notFound('Stash item');
    return row;
  }

  values.push(stashItemId, campaignId);
  const result = await pool.query(
    `UPDATE character_items SET ${sets.join(', ')} WHERE id = $${i++} AND campaign_id = $${i} RETURNING *`,
    values,
  );
  const row = result.rows[0];
  if (!row) throw notFound('Stash item');
  return row;
}

export async function removeCampaignStashItem(pool: Pool, campaignId: string, stashItemId: string): Promise<void> {
  const result = await pool.query(
    `DELETE FROM character_items WHERE id = $1 AND campaign_id = $2`,
    [stashItemId, campaignId],
  );
  if (result.rowCount === 0) throw notFound('Stash item');
}

// Moves a stash row onto a character — a plain ownership transfer (one
// UPDATE), not a delete+recreate, so the row keeps its id/quantity/
// custom_name/notes/charges_remaining exactly as they were in the stash.
// isEquipped/isAttuned stay at their column defaults (false) since a
// just-received item isn't equipped yet — the player equips it afterward
// via the existing PATCH /characters/:id/items/:itemId route.
export async function giveCampaignStashItemToCharacter(
  pool: Pool,
  campaignId: string,
  stashItemId: string,
  characterId: string,
) {
  const character = await fetchCharacterOrThrow(pool, characterId);
  if (character.campaign_id !== campaignId) throw notFound('Character');

  const result = await pool.query(
    `UPDATE character_items SET character_id = $1, campaign_id = NULL
     WHERE id = $2 AND campaign_id = $3
     RETURNING *`,
    [characterId, stashItemId, campaignId],
  );
  const row = result.rows[0];
  if (!row) throw notFound('Stash item');
  return row;
}

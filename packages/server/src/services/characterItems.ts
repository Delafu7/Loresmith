// character_items: the owned/equipped instance of an `items` catalog
// template (PLAN.md §3.1). Same ownership rule as character_spells — DM or
// the owning player only for mutations, any campaign member for reads.
//
// :itemId in the routes (PATCH/DELETE /characters/:id/items/:itemId) is the
// character_items ROW id, not the catalog items.id — a character can own
// several instances of the same catalog item (e.g. two potions tracked as
// separate rows, or the more common single row with quantity=2), and only
// the row id unambiguously identifies "this specific inventory line."

import type { Pool } from 'pg';
import { notFound } from '../middleware/errors.js';
import { requireMembership } from './authz.js';
import { authorizeCharacterMutation, fetchCharacterOrThrow } from './characters.js';
import { recomputeAndApplyCharacterArmorClass, type ArmorClassEncounterSync } from './armorClass.js';
import type { CreateCharacterItemInput, UpdateCharacterItemInput } from '../schemas/characterItems.js';

export async function listCharacterItems(pool: Pool, actorId: string, characterId: string) {
  const character = await fetchCharacterOrThrow(pool, characterId);
  await requireMembership(pool, character.campaign_id, actorId);
  const result = await pool.query(
    `SELECT * FROM character_items WHERE character_id = $1 ORDER BY acquired_at ASC`,
    [characterId],
  );
  return result.rows;
}

const UPDATABLE_COLUMNS: Record<string, string> = {
  quantity: 'quantity',
  isEquipped: 'is_equipped',
  isAttuned: 'is_attuned',
  customName: 'custom_name',
  chargesRemaining: 'charges_remaining',
  notes: 'notes',
};

// Item types whose is_equipped flag can affect a character's computed AC —
// see recomputeAndApplyCharacterArmorClass's "one armor + optional shield"
// design (services/armorClass.ts).
const ARMOR_CLASS_RELEVANT_ITEM_TYPES = new Set(['armor', 'shield']);

export interface ArmorClassSync {
  character: Record<string, unknown>;
  encounterSyncs: ArmorClassEncounterSync[];
}

export interface UpdateCharacterItemResult {
  item: Record<string, unknown>;
  // Always the character's current row (freshly re-read after a recompute
  // when one ran, otherwise the pre-mutation snapshot, which is still
  // accurate since nothing about armor_class changed in that path either).
  // Callers (the route layer, and the frontend's InventoryPanel) use this to
  // keep the character sheet's displayed AC in sync after an equip toggle —
  // without it, a client that isn't also subscribed to PARTICIPANT_AC_CHANGED
  // (i.e. not viewing a live encounter's combat tracker) would have no way
  // to learn the server just recomputed a new AC, and would show a stale
  // number until an unrelated refetch happened to occur.
  character: Record<string, unknown>;
  // Set only when this update toggled is_equipped on an armor/shield row,
  // the owning character is in armor_class_mode='auto', AND the recompute
  // actually changed the stored AC — null in every other case (manual mode,
  // non-equip-affecting patch, or an equip toggle that happened not to
  // change the computed value, e.g. swapping between two rows with the same
  // stats). The route layer broadcasts PARTICIPANT_AC_CHANGED per sync
  // target only when this is non-null.
  armorClassSync: ArmorClassSync | null;
}

export async function addCharacterItem(
  pool: Pool,
  actorId: string,
  characterId: string,
  input: CreateCharacterItemInput,
): Promise<UpdateCharacterItemResult> {
  const character = await fetchCharacterOrThrow(pool, characterId);
  await authorizeCharacterMutation(pool, actorId, character);

  // Runs in a transaction because a newly-added item can be created
  // pre-equipped (input.isEquipped=true) — same AC recompute-atomicity
  // requirement as the equip-TOGGLE path below. (Pre-merge review finding:
  // this path originally did a bare single-statement INSERT with no
  // recompute at all, so an armor/shield row added already-equipped left an
  // armor_class_mode='auto' character with a stale AC until some unrelated
  // mutation happened to trigger a recompute.)
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const result = await client.query(
      `INSERT INTO character_items (character_id, item_id, quantity, is_equipped, is_attuned, custom_name, charges_remaining, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        characterId, input.itemId, input.quantity, input.isEquipped, input.isAttuned,
        input.customName ?? null, input.chargesRemaining ?? null, input.notes ?? null,
      ],
    );
    const row = result.rows[0];

    // No outer `character.armor_class_mode === 'auto'` gate here (or in
    // updateCharacterItem below) — that pre-transaction snapshot is a TOCTOU
    // risk (pre-merge review finding: a concurrent armor-class-mode toggle
    // could commit in the gap between the snapshot and this transaction).
    // recomputeAndApplyCharacterArmorClass does its own SELECT ... FOR UPDATE
    // and safely no-ops if the LOCKED read shows manual mode, so it's always
    // safe to just attempt it whenever the item type is AC-relevant.
    let armorClassSync: ArmorClassSync | null = null;
    let currentCharacter: Record<string, unknown> = character;
    if (input.isEquipped) {
      const itemTypeRes = await client.query<{ item_type: string }>(`SELECT item_type FROM items WHERE id = $1`, [row.item_id]);
      const itemType = itemTypeRes.rows[0]?.item_type;
      if (itemType && ARMOR_CLASS_RELEVANT_ITEM_TYPES.has(itemType)) {
        const acResult = await recomputeAndApplyCharacterArmorClass(client, characterId);
        currentCharacter = acResult.character;
        if (acResult.changed) {
          armorClassSync = { character: acResult.character, encounterSyncs: acResult.encounterSyncs };
        }
      }
    }

    await client.query('COMMIT');
    return { item: row, character: currentCharacter, armorClassSync };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function updateCharacterItem(
  pool: Pool,
  actorId: string,
  characterId: string,
  characterItemId: string,
  input: UpdateCharacterItemInput,
): Promise<UpdateCharacterItemResult> {
  const character = await fetchCharacterOrThrow(pool, characterId);
  await authorizeCharacterMutation(pool, actorId, character);

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
    const existing = await pool.query(`SELECT * FROM character_items WHERE id = $1 AND character_id = $2`, [characterItemId, characterId]);
    const row = existing.rows[0];
    if (!row) throw notFound('Character item');
    return { item: row, character, armorClassSync: null };
  }

  // The equip toggle needs to be atomic with an AC recompute-and-write-back
  // (PLAN.md §3.5), so this now always runs in an explicit transaction —
  // previously a single pool.query() since no other write depended on it.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    values.push(characterItemId, characterId);
    const result = await client.query(
      `UPDATE character_items SET ${sets.join(', ')} WHERE id = $${i++} AND character_id = $${i} RETURNING *`,
      values,
    );
    const row = result.rows[0];
    if (!row) throw notFound('Character item');

    let armorClassSync: ArmorClassSync | null = null;
    let currentCharacter: Record<string, unknown> = character;
    if (input.isEquipped !== undefined) {
      const itemTypeRes = await client.query<{ item_type: string }>(`SELECT item_type FROM items WHERE id = $1`, [row.item_id]);
      const itemType = itemTypeRes.rows[0]?.item_type;
      if (itemType && ARMOR_CLASS_RELEVANT_ITEM_TYPES.has(itemType)) {
        const acResult = await recomputeAndApplyCharacterArmorClass(client, characterId);
        currentCharacter = acResult.character;
        if (acResult.changed) {
          armorClassSync = { character: acResult.character, encounterSyncs: acResult.encounterSyncs };
        }
      }
    }

    await client.query('COMMIT');
    return { item: row, character: currentCharacter, armorClassSync };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function removeCharacterItem(
  pool: Pool,
  actorId: string,
  characterId: string,
  characterItemId: string,
): Promise<void> {
  const character = await fetchCharacterOrThrow(pool, characterId);
  await authorizeCharacterMutation(pool, actorId, character);

  const result = await pool.query(`DELETE FROM character_items WHERE id = $1 AND character_id = $2`, [characterItemId, characterId]);
  if (result.rowCount === 0) throw notFound('Character item');
}

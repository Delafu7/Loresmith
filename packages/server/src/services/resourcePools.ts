// character_resource_pools: generic countable resource tracking (ki points,
// rage uses, spell slots — the spell_slot_N/warlock_pact_slot_N rows are a
// computed cache, see services/spellSlots.ts). Same ownership rule as every
// other character-mutation endpoint.

import type { Pool } from 'pg';
import { AppError, notFound } from '../middleware/errors.js';
import { requireMembership } from './authz.js';
import { authorizeCharacterMutation, fetchCharacterOrThrow } from './characters.js';
import type { ResourceAmountInput } from '../schemas/resources.js';

export async function listResourcePools(pool: Pool, actorId: string, characterId: string) {
  const character = await fetchCharacterOrThrow(pool, characterId);
  await requireMembership(pool, character.campaign_id, actorId);
  const result = await pool.query(
    `SELECT * FROM character_resource_pools WHERE character_id = $1 ORDER BY resource_key ASC`,
    [characterId],
  );
  return result.rows;
}

/**
 * Atomic spend: the WHERE clause's `current_value - $amount >= 0` makes the
 * "don't go negative" check part of the same statement as the decrement, so
 * two concurrent spends against the same pool can't both read a stale
 * current_value and both succeed — one wins, the other's UPDATE matches zero
 * rows and falls through to the insufficient-balance check below.
 */
export async function spendResource(
  pool: Pool,
  actorId: string,
  characterId: string,
  resourceKey: string,
  input: ResourceAmountInput,
) {
  const character = await fetchCharacterOrThrow(pool, characterId);
  await authorizeCharacterMutation(pool, actorId, character);

  const result = await pool.query(
    `UPDATE character_resource_pools
     SET current_value = current_value - $1
     WHERE character_id = $2 AND resource_key = $3 AND current_value - $1 >= 0
     RETURNING *`,
    [input.amount, characterId, resourceKey],
  );
  if (result.rows.length > 0) return result.rows[0];

  // The UPDATE matched zero rows — find out why (pool doesn't exist at all
  // vs. exists but insufficient) only on this failure path, so the common
  // (successful) case above stays a single round trip.
  const existing = await pool.query(
    `SELECT current_value FROM character_resource_pools WHERE character_id = $1 AND resource_key = $2`,
    [characterId, resourceKey],
  );
  const row = existing.rows[0];
  if (!row) throw notFound(`Resource pool '${resourceKey}'`);
  throw new AppError('CONFLICT', `Not enough '${resourceKey}' remaining`, {
    current: row.current_value,
    requested: input.amount,
  });
}

export async function recoverResource(
  pool: Pool,
  actorId: string,
  characterId: string,
  resourceKey: string,
  input: ResourceAmountInput,
) {
  const character = await fetchCharacterOrThrow(pool, characterId);
  await authorizeCharacterMutation(pool, actorId, character);

  const result = await pool.query(
    `UPDATE character_resource_pools
     SET current_value = LEAST(max_value, current_value + $1)
     WHERE character_id = $2 AND resource_key = $3
     RETURNING *`,
    [input.amount, characterId, resourceKey],
  );
  const row = result.rows[0];
  if (!row) throw notFound(`Resource pool '${resourceKey}'`);
  return row;
}

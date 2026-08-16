// character_currency (Phase 1.5 of the backlog implementation plan): the
// one purse per character. Same membership-for-read / owner-or-DM-for-write
// split as character_items (services/characterItems.ts) — any campaign
// member can see a character's coin, only the DM or the owning player can
// change it.

import type { Pool } from 'pg';
import { authorizeCharacterMutation, fetchCharacterOrThrow, requireCharacterReadAccess } from './characters.js';
import type { UpdateCharacterCurrencyInput } from '../schemas/characterCurrency.js';

export interface CharacterCurrency {
  character_id: string;
  cp: number;
  sp: number;
  ep: number;
  gp: number;
  pp: number;
  updated_at: string;
}

const ZERO_CURRENCY = { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 } as const;

export async function getCharacterCurrency(pool: Pool, actorId: string, characterId: string): Promise<CharacterCurrency> {
  const character = await fetchCharacterOrThrow(pool, characterId);
  await requireCharacterReadAccess(pool, actorId, character);

  const result = await pool.query<CharacterCurrency>(`SELECT * FROM character_currency WHERE character_id = $1`, [characterId]);
  // No row yet (never spent/earned anything) means an empty purse, not a 404
  // — every character implicitly has a currency record from the moment it
  // exists, this table just doesn't materialize the zero-row until the first write.
  return result.rows[0] ?? { character_id: characterId, ...ZERO_CURRENCY, updated_at: new Date().toISOString() };
}

export async function updateCharacterCurrency(
  pool: Pool,
  actorId: string,
  characterId: string,
  input: UpdateCharacterCurrencyInput,
): Promise<CharacterCurrency> {
  const character = await fetchCharacterOrThrow(pool, characterId);
  await authorizeCharacterMutation(pool, actorId, character);

  // A single null-means-"unset" parameter list feeds both branches: the
  // INSERT side falls back to 0 (a brand new purse's untouched
  // denominations), the ON CONFLICT UPDATE side falls back to the existing
  // stored value (a partial PATCH must not zero out fields it didn't mention).
  const result = await pool.query<CharacterCurrency>(
    `INSERT INTO character_currency (character_id, cp, sp, ep, gp, pp)
     VALUES ($1, COALESCE($2, 0), COALESCE($3, 0), COALESCE($4, 0), COALESCE($5, 0), COALESCE($6, 0))
     ON CONFLICT (character_id) DO UPDATE SET
       cp = COALESCE($2, character_currency.cp),
       sp = COALESCE($3, character_currency.sp),
       ep = COALESCE($4, character_currency.ep),
       gp = COALESCE($5, character_currency.gp),
       pp = COALESCE($6, character_currency.pp),
       updated_at = now()
     RETURNING *`,
    [characterId, input.cp ?? null, input.sp ?? null, input.ep ?? null, input.gp ?? null, input.pp ?? null],
  );
  return result.rows[0]!;
}

// character_feats: the join persisting feat selection made during character
// creation (compendium feature, Phase 5) — previously nowhere to store it,
// feats/catalog.ts was read-only. Same ownership rule as every other
// character-mutation endpoint: DM or the owning player only (see
// authorizeCharacterMutation in services/characters.ts); any campaign member
// may read. Minimal (character_id, feat_id) composite-PK shape (migration
// 1784269823666_create-character-feats.ts) — no per-row update, only
// grant/revoke.

import type { Pool } from 'pg';
import { AppError, notFound } from '../middleware/errors.js';
import { requireMembership } from './authz.js';
import { authorizeCharacterMutation, fetchCharacterOrThrow } from './characters.js';
import { isUniqueViolation } from './dbErrors.js';
import type { CreateCharacterFeatInput } from '../schemas/characterFeats.js';

export async function listCharacterFeats(pool: Pool, actorId: string, characterId: string) {
  const character = await fetchCharacterOrThrow(pool, characterId);
  await requireMembership(pool, character.campaign_id, actorId);
  const result = await pool.query(
    `SELECT * FROM character_feats WHERE character_id = $1 ORDER BY granted_at ASC`,
    [characterId],
  );
  return result.rows;
}

export async function grantCharacterFeat(pool: Pool, actorId: string, characterId: string, input: CreateCharacterFeatInput) {
  const character = await fetchCharacterOrThrow(pool, characterId);
  await authorizeCharacterMutation(pool, actorId, character);

  try {
    const result = await pool.query(
      `INSERT INTO character_feats (character_id, feat_id) VALUES ($1, $2) RETURNING *`,
      [characterId, input.featId],
    );
    return result.rows[0];
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new AppError('CONFLICT', 'This character already has that feat');
    }
    throw err;
  }
}

export async function revokeCharacterFeat(pool: Pool, actorId: string, characterId: string, featId: string): Promise<void> {
  const character = await fetchCharacterOrThrow(pool, characterId);
  await authorizeCharacterMutation(pool, actorId, character);

  const result = await pool.query(`DELETE FROM character_feats WHERE character_id = $1 AND feat_id = $2`, [characterId, featId]);
  if (result.rowCount === 0) throw notFound('Character feat');
}

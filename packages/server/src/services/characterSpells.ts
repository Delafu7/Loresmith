// character_spells: the known/prepared join (PLAN.md §3.1) — one row per
// (character, spell, granting class). Same ownership rule as every other
// character-mutation endpoint: DM or the owning player only (see
// authorizeCharacterMutation in services/characters.ts); any campaign member
// may read (matches getClasses/getSkillProficiencies's precedent).

import type { Pool } from 'pg';
import { AppError, notFound } from '../middleware/errors.js';
import { requireMembership } from './authz.js';
import { authorizeCharacterMutation, fetchCharacterOrThrow } from './characters.js';
import { isUniqueViolation } from './dbErrors.js';
import type { CreateCharacterSpellInput, UpdateCharacterSpellInput } from '../schemas/characterSpells.js';

export async function listCharacterSpells(pool: Pool, actorId: number, characterId: number) {
  const character = await fetchCharacterOrThrow(pool, characterId);
  await requireMembership(pool, character.campaign_id, actorId);
  const result = await pool.query(
    `SELECT * FROM character_spells WHERE character_id = $1 ORDER BY spell_id ASC`,
    [characterId],
  );
  return result.rows;
}

export async function learnCharacterSpell(
  pool: Pool,
  actorId: number,
  characterId: number,
  input: CreateCharacterSpellInput,
) {
  const character = await fetchCharacterOrThrow(pool, characterId);
  await authorizeCharacterMutation(pool, actorId, character);

  try {
    const result = await pool.query(
      `INSERT INTO character_spells (character_id, spell_id, class_id, is_prepared, always_prepared, source)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [characterId, input.spellId, input.classId ?? null, input.isPrepared, input.alwaysPrepared, input.source],
    );
    return result.rows[0];
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new AppError('CONFLICT', 'This character already has that spell recorded for that class');
    }
    throw err;
  }
}

// Resolves a (characterId, spellId[, classId]) tuple to exactly one
// character_spells row, throwing a clear VALIDATION_ERROR (rather than
// silently picking one, or worse, updating/deleting more than one row) if a
// multiclass caster has the same spell available via more than one granting
// class and the caller didn't disambiguate with classId.
async function findOneCharacterSpellRow(
  pool: Pool,
  characterId: number,
  spellId: number,
  classId: number | undefined,
): Promise<{ id: number; class_id: number | null }> {
  const params: unknown[] = [characterId, spellId];
  let query = `SELECT id, class_id FROM character_spells WHERE character_id = $1 AND spell_id = $2`;
  if (classId !== undefined) {
    query += ` AND class_id = $3`;
    params.push(classId);
  }
  const result = await pool.query<{ id: number; class_id: number | null }>(query, params);
  if (result.rows.length === 0) throw notFound('Character spell');
  if (result.rows.length > 1) {
    throw new AppError(
      'VALIDATION_ERROR',
      'This spell is known via more than one class on this character; pass ?classId= to disambiguate',
      { candidateClassIds: result.rows.map((r) => r.class_id) },
    );
  }
  return result.rows[0]!;
}

export async function toggleCharacterSpellPrepared(
  pool: Pool,
  actorId: number,
  characterId: number,
  spellId: number,
  classId: number | undefined,
  input: UpdateCharacterSpellInput,
) {
  const character = await fetchCharacterOrThrow(pool, characterId);
  await authorizeCharacterMutation(pool, actorId, character);

  const row = await findOneCharacterSpellRow(pool, characterId, spellId, classId);
  const result = await pool.query(
    `UPDATE character_spells SET is_prepared = $1 WHERE id = $2 RETURNING *`,
    [input.isPrepared, row.id],
  );
  return result.rows[0];
}

export async function unlearnCharacterSpell(
  pool: Pool,
  actorId: number,
  characterId: number,
  spellId: number,
  classId: number | undefined,
): Promise<void> {
  const character = await fetchCharacterOrThrow(pool, characterId);
  await authorizeCharacterMutation(pool, actorId, character);

  const row = await findOneCharacterSpellRow(pool, characterId, spellId, classId);
  await pool.query(`DELETE FROM character_spells WHERE id = $1`, [row.id]);
}

// character_attacks: a character's structured, selectable attack list
// (REFACTOR-PLAN.md §6 / docs/rules/attacks-and-damage.md §2.1) — a real
// table, not JSONB (unlike monsters' catalog actions), since a PC's attack
// list mutates often in play and each row needs a stable id for the
// apply-damage endpoint (services/characters.ts) to reference. Same
// ownership rule as character_items/character_spells — DM or the owning
// player only for mutations, any campaign member for reads.

import type { Pool } from 'pg';
import { AppError, notFound } from '../middleware/errors.js';
import { isCheckViolation } from './dbErrors.js';
import { authorizeCharacterMutation, fetchCharacterOrThrow, requireCharacterReadAccess } from './characters.js';
import type { CreateCharacterAttackInput, UpdateCharacterAttackInput } from '../schemas/characterAttacks.js';

export async function listCharacterAttacks(pool: Pool, actorId: string, characterId: string) {
  const character = await fetchCharacterOrThrow(pool, characterId);
  await requireCharacterReadAccess(pool, actorId, character);
  const result = await pool.query(
    `SELECT * FROM character_attacks WHERE character_id = $1 ORDER BY sort_order ASC, id ASC`,
    [characterId],
  );
  return result.rows;
}

// docs/roadmap/dnd-2024-gap-analysis.md P1-6 — itemId, when provided, must
// reference a real catalog weapon (not e.g. a potion or a suit of armor).
// Doesn't require item_type = 'weapon' to also carry a mastery property —
// most seeded items don't, and that's fine (attackBonus/damageDice already
// work with no mastery at all); this just rejects an obviously-wrong link.
async function assertItemIsWeapon(pool: Pool, itemId: string): Promise<void> {
  const result = await pool.query<{ item_type: string }>(`SELECT item_type FROM items WHERE id = $1`, [itemId]);
  const row = result.rows[0];
  if (!row) throw new AppError('VALIDATION_ERROR', 'itemId does not reference an existing item');
  if (row.item_type !== 'weapon') throw new AppError('VALIDATION_ERROR', 'itemId must reference a weapon item');
}

export async function addCharacterAttack(pool: Pool, actorId: string, characterId: string, input: CreateCharacterAttackInput) {
  const character = await fetchCharacterOrThrow(pool, characterId);
  await authorizeCharacterMutation(pool, actorId, character);
  if (input.itemId) await assertItemIsWeapon(pool, input.itemId);

  try {
    const result = await pool.query(
      `INSERT INTO character_attacks
         (character_id, name, attack_bonus, damage_dice, damage_type, save_dc, save_ability_index, half_on_save, notes, sort_order, item_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING *`,
      [
        characterId, input.name, input.attackBonus ?? null, input.damageDice ?? null, input.damageType ?? null,
        input.saveDc ?? null, input.saveAbilityIndex ?? null, input.halfOnSave, input.notes ?? null, input.sortOrder,
        input.itemId ?? null,
      ],
    );
    return result.rows[0];
  } catch (err) {
    if (isCheckViolation(err)) {
      throw new AppError('VALIDATION_ERROR', 'Attack data violates a database constraint', { cause: String(err) });
    }
    throw err;
  }
}

const UPDATABLE_COLUMNS: Record<string, string> = {
  name: 'name',
  attackBonus: 'attack_bonus',
  damageDice: 'damage_dice',
  damageType: 'damage_type',
  saveDc: 'save_dc',
  saveAbilityIndex: 'save_ability_index',
  halfOnSave: 'half_on_save',
  notes: 'notes',
  sortOrder: 'sort_order',
  itemId: 'item_id',
};

export async function updateCharacterAttack(
  pool: Pool,
  actorId: string,
  characterId: string,
  attackId: string,
  input: UpdateCharacterAttackInput,
) {
  const character = await fetchCharacterOrThrow(pool, characterId);
  await authorizeCharacterMutation(pool, actorId, character);
  if (input.itemId) await assertItemIsWeapon(pool, input.itemId);

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
    const existing = await pool.query(`SELECT * FROM character_attacks WHERE id = $1 AND character_id = $2`, [attackId, characterId]);
    const row = existing.rows[0];
    if (!row) throw notFound('Character attack');
    return row;
  }

  values.push(attackId, characterId);
  try {
    const result = await pool.query(
      `UPDATE character_attacks SET ${sets.join(', ')} WHERE id = $${i++} AND character_id = $${i} RETURNING *`,
      values,
    );
    const row = result.rows[0];
    if (!row) throw notFound('Character attack');
    return row;
  } catch (err) {
    // Catches the case the schema's own .refine() can't: this PATCH only
    // set ONE of attackBonus/saveDc, but the row already had the other set
    // from a previous write — the payload alone never revealed the
    // conflict, only the resulting row does, which is exactly what the DB
    // CHECK constraint is for.
    if (isCheckViolation(err)) {
      throw new AppError('VALIDATION_ERROR', 'Attack data violates a database constraint', { cause: String(err) });
    }
    throw err;
  }
}

export async function removeCharacterAttack(pool: Pool, actorId: string, characterId: string, attackId: string): Promise<void> {
  const character = await fetchCharacterOrThrow(pool, characterId);
  await authorizeCharacterMutation(pool, actorId, character);

  const result = await pool.query(`DELETE FROM character_attacks WHERE id = $1 AND character_id = $2`, [attackId, characterId]);
  if (result.rowCount === 0) throw notFound('Character attack');
}

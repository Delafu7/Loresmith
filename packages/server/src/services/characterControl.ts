// Iteration 2 "Character ownership vs. control" — delegation of live
// control (who currently drives a character) separate from stable
// ownership (characters.owner_user_id, never touched here). DM-only:
// granting/revoking control is a DM call, same as assignCharacterToPlayer's
// ownership reassignment. Transactional, row-locked, and reads the "from"
// side off the locked row rather than trusting a caller-supplied value —
// exact pattern services/encounters.ts's transitionDisposition established
// for encounter_disposition_events; character_control_delegations mirrors
// its shape.

import type { Pool } from 'pg';
import { AppError, notFound } from '../middleware/errors.js';
import { requireMembership, requireDm, getMembership } from './authz.js';
import type { DelegateControlInput } from '../schemas/characters.js';

interface CharacterControlRow {
  id: string;
  campaign_id: string;
  owner_user_id: string | null;
  controller_user_id: string | null;
  [key: string]: unknown;
}

export interface ControlDelegationEventRow {
  id: string;
  character_id: string;
  from_controller_user_id: string | null;
  to_controller_user_id: string | null;
  granted_by_user_id: string;
  reason: string | null;
  encounter_id: string | null;
  expires_at: string | null;
  created_at: string;
}

export interface DelegateControlResult {
  character: CharacterControlRow;
  event: ControlDelegationEventRow;
}

export async function delegateControl(
  pool: Pool,
  characterId: string,
  grantedByUserId: string,
  input: DelegateControlInput,
): Promise<DelegateControlResult> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const current = await client.query<CharacterControlRow>(`SELECT * FROM characters WHERE id = $1 FOR UPDATE`, [characterId]);
    const before = current.rows[0];
    if (!before) throw notFound('Character');

    const role = await requireMembership(pool, before.campaign_id, grantedByUserId);
    requireDm(role);

    if (!before.is_pc) {
      throw new AppError('VALIDATION_ERROR', 'Cannot delegate control of an NPC — the DM already controls every NPC by default');
    }

    const targetRole = await getMembership(pool, before.campaign_id, input.toUserId);
    if (!targetRole) {
      throw new AppError('VALIDATION_ERROR', 'That user is not a member of this campaign');
    }
    if (targetRole === 'spectator') {
      throw new AppError('VALIDATION_ERROR', 'Spectators cannot be delegated control of a character');
    }

    const fromControllerUserId: string | null = before.controller_user_id ?? before.owner_user_id;
    if (fromControllerUserId === input.toUserId) {
      throw new AppError('VALIDATION_ERROR', 'That user already controls this character');
    }

    const updated = await client.query<CharacterControlRow>(
      `UPDATE characters SET controller_user_id = $1 WHERE id = $2 RETURNING *`,
      [input.toUserId, characterId],
    );

    const eventRes = await client.query<ControlDelegationEventRow>(
      `INSERT INTO character_control_delegations
         (character_id, from_controller_user_id, to_controller_user_id, granted_by_user_id, reason, encounter_id, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        characterId, fromControllerUserId, input.toUserId, grantedByUserId,
        input.reason ?? null, input.encounterId ?? null, input.expiresAt ?? null,
      ],
    );

    await client.query('COMMIT');
    return { character: updated.rows[0]!, event: eventRes.rows[0]! };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function revokeControl(pool: Pool, characterId: string, grantedByUserId: string): Promise<DelegateControlResult> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const current = await client.query<CharacterControlRow>(`SELECT * FROM characters WHERE id = $1 FOR UPDATE`, [characterId]);
    const before = current.rows[0];
    if (!before) throw notFound('Character');

    const role = await requireMembership(pool, before.campaign_id, grantedByUserId);
    requireDm(role);

    if (before.controller_user_id === null) {
      throw new AppError('VALIDATION_ERROR', 'This character has no active control delegation to revoke');
    }

    const updated = await client.query<CharacterControlRow>(
      `UPDATE characters SET controller_user_id = NULL WHERE id = $1 RETURNING *`,
      [characterId],
    );

    const eventRes = await client.query<ControlDelegationEventRow>(
      `INSERT INTO character_control_delegations
         (character_id, from_controller_user_id, to_controller_user_id, granted_by_user_id, reason)
       VALUES ($1, $2, NULL, $3, 'revoked')
       RETURNING *`,
      [characterId, before.controller_user_id, grantedByUserId],
    );

    await client.query('COMMIT');
    return { character: updated.rows[0]!, event: eventRes.rows[0]! };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Any campaign member may read a character's delegation history (same
// read-openness as encounter disposition history) — it's a transparency/
// dispute-resolution log, not sensitive data.
export async function listControlDelegations(pool: Pool, actorId: string, characterId: string): Promise<ControlDelegationEventRow[]> {
  const characterRes = await pool.query<{ campaign_id: string }>(`SELECT campaign_id FROM characters WHERE id = $1`, [characterId]);
  const character = characterRes.rows[0];
  if (!character) throw notFound('Character');
  await requireMembership(pool, character.campaign_id, actorId);

  const result = await pool.query<ControlDelegationEventRow>(
    `SELECT * FROM character_control_delegations WHERE character_id = $1 ORDER BY created_at DESC`,
    [characterId],
  );
  return result.rows;
}

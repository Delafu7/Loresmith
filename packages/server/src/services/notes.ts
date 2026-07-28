// Session/lore notes — visible to the whole campaign now (hide/reveal was
// removed; notes.visible_to_players no longer exists).

import type { Pool } from 'pg';
import { AppError, notFound } from '../middleware/errors.js';
import type { CampaignRole } from './authz.js';
import type { CreateNoteInput, UpdateNoteInput } from '../schemas/notes.js';

interface NoteRow {
  id: string;
  campaign_id: string;
  author_user_id: string;
  [key: string]: unknown;
}

async function fetchNoteScoped(pool: Pool, campaignId: string, noteId: string): Promise<NoteRow> {
  const result = await pool.query<NoteRow>(`SELECT * FROM notes WHERE id = $1 AND campaign_id = $2`, [noteId, campaignId]);
  const row = result.rows[0];
  if (!row) throw notFound('Note');
  return row;
}

export async function listNotes(pool: Pool, campaignId: string, _role: CampaignRole) {
  const result = await pool.query(`SELECT * FROM notes WHERE campaign_id = $1 ORDER BY created_at DESC`, [campaignId]);
  return result.rows;
}

export async function getNote(pool: Pool, campaignId: string, noteId: string, _role: CampaignRole) {
  return fetchNoteScoped(pool, campaignId, noteId);
}

export async function createNote(
  pool: Pool,
  campaignId: string,
  actorId: string,
  _role: CampaignRole,
  input: CreateNoteInput,
) {
  const result = await pool.query(
    `INSERT INTO notes (campaign_id, session_id, character_id, author_user_id, title, body)
     VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING *`,
    [campaignId, input.sessionId ?? null, input.characterId ?? null, actorId, input.title, input.body],
  );
  return result.rows[0];
}

export async function updateNote(
  pool: Pool,
  campaignId: string,
  noteId: string,
  actorId: string,
  role: CampaignRole,
  input: UpdateNoteInput,
) {
  const note = await fetchNoteScoped(pool, campaignId, noteId);
  if (role === 'player' && note.author_user_id !== actorId) {
    throw new AppError('FORBIDDEN_NOT_OWNER', 'You can only edit notes you authored');
  }

  const sets: string[] = [];
  const values: unknown[] = [];
  let i = 1;
  const columnByKey: Record<string, string> = {
    title: 'title', body: 'body', sessionId: 'session_id', characterId: 'character_id',
  };
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;
    const column = columnByKey[key];
    if (!column) continue;
    sets.push(`${column} = $${i++}`);
    values.push(value);
  }
  if (sets.length === 0) return note;

  sets.push(`updated_at = now()`);
  values.push(noteId);
  const result = await pool.query(`UPDATE notes SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`, values);
  return result.rows[0];
}

export async function deleteNote(pool: Pool, campaignId: string, noteId: string, actorId: string, role: CampaignRole): Promise<void> {
  const note = await fetchNoteScoped(pool, campaignId, noteId);
  if (role === 'player' && note.author_user_id !== actorId) {
    throw new AppError('FORBIDDEN_NOT_OWNER', 'You can only delete notes you authored');
  }
  await pool.query(`DELETE FROM notes WHERE id = $1`, [noteId]);
}

// Same "read the row, drop id/timestamps, re-insert every remaining column"
// copy approach as duplicateCharacter (services/characters.ts), so this
// doesn't drift out of sync as the table gains columns. Same owner-or-DM
// authorization as update/delete above. author_user_id is re-stamped to the
// actor doing the duplicating, not necessarily the original author.
export async function duplicateNote(
  pool: Pool,
  campaignId: string,
  noteId: string,
  actorId: string,
  role: CampaignRole,
) {
  const source = await fetchNoteScoped(pool, campaignId, noteId);
  if (role === 'player' && source.author_user_id !== actorId) {
    throw new AppError('FORBIDDEN_NOT_OWNER', 'You can only duplicate notes you authored');
  }

  const omit = new Set(['id', 'created_at', 'updated_at']);
  const columns: string[] = [];
  const values: unknown[] = [];
  for (const [col, val] of Object.entries(source)) {
    if (omit.has(col) || col.endsWith('_legacy')) continue;
    columns.push(col);
    if (col === 'title') values.push(`${String(val)} (Copy)`);
    else if (col === 'author_user_id') values.push(actorId);
    else values.push(val);
  }

  const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
  const result = await pool.query(
    `INSERT INTO notes (${columns.join(', ')}) VALUES (${placeholders}) RETURNING *`,
    values,
  );
  return result.rows[0];
}

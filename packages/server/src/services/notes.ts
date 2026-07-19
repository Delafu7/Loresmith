// Session/lore notes. Players never see visible_to_players=false rows —
// filtered at the query level (PLAN.md §4.1), not just left to the client.

import type { Pool } from 'pg';
import { AppError, notFound } from '../middleware/errors.js';
import type { CampaignRole } from './authz.js';
import type { CreateNoteInput, UpdateNoteInput } from '../schemas/notes.js';

interface NoteRow {
  id: number;
  campaign_id: number;
  author_user_id: number;
  visible_to_players: boolean;
  [key: string]: unknown;
}

async function fetchNoteScoped(pool: Pool, campaignId: number, noteId: number, role: CampaignRole): Promise<NoteRow> {
  const result = await pool.query<NoteRow>(`SELECT * FROM notes WHERE id = $1 AND campaign_id = $2`, [noteId, campaignId]);
  const row = result.rows[0];
  // A DM-hidden note 404s for a player exactly like a nonexistent one would —
  // otherwise a 403 would leak "a hidden note exists here".
  if (!row || (role === 'player' && !row.visible_to_players)) {
    throw notFound('Note');
  }
  return row;
}

export async function listNotes(pool: Pool, campaignId: number, role: CampaignRole) {
  if (role === 'dm') {
    const result = await pool.query(`SELECT * FROM notes WHERE campaign_id = $1 ORDER BY created_at DESC`, [campaignId]);
    return result.rows;
  }
  const result = await pool.query(
    `SELECT * FROM notes WHERE campaign_id = $1 AND visible_to_players = true ORDER BY created_at DESC`,
    [campaignId],
  );
  return result.rows;
}

export async function getNote(pool: Pool, campaignId: number, noteId: number, role: CampaignRole) {
  return fetchNoteScoped(pool, campaignId, noteId, role);
}

export async function createNote(
  pool: Pool,
  campaignId: number,
  actorId: number,
  role: CampaignRole,
  input: CreateNoteInput,
) {
  // Players can jot down their own notes, but can never hide a note from the
  // rest of the table — that's a DM-only tool (secrets, unrevealed lore).
  const visibleToPlayers = role === 'player' ? true : (input.visibleToPlayers ?? false);

  const result = await pool.query(
    `INSERT INTO notes (campaign_id, session_id, character_id, author_user_id, title, body, visible_to_players)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING *`,
    [campaignId, input.sessionId ?? null, input.characterId ?? null, actorId, input.title, input.body, visibleToPlayers],
  );
  return result.rows[0];
}

export async function updateNote(
  pool: Pool,
  campaignId: number,
  noteId: number,
  actorId: number,
  role: CampaignRole,
  input: UpdateNoteInput,
) {
  const note = await fetchNoteScoped(pool, campaignId, noteId, role);
  if (role === 'player') {
    if (Number(note.author_user_id) !== Number(actorId)) {
      throw new AppError('FORBIDDEN_NOT_OWNER', 'You can only edit notes you authored');
    }
    if (input.visibleToPlayers === false) {
      throw new AppError('FORBIDDEN_ROLE', 'Players cannot hide notes from the rest of the table');
    }
    delete input.visibleToPlayers; // players can't grant themselves DM-only visibility control either
  }

  const sets: string[] = [];
  const values: unknown[] = [];
  let i = 1;
  const columnByKey: Record<string, string> = {
    title: 'title', body: 'body', sessionId: 'session_id', characterId: 'character_id', visibleToPlayers: 'visible_to_players',
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

export async function deleteNote(pool: Pool, campaignId: number, noteId: number, actorId: number, role: CampaignRole): Promise<void> {
  const note = await fetchNoteScoped(pool, campaignId, noteId, role);
  if (role === 'player' && Number(note.author_user_id) !== Number(actorId)) {
    throw new AppError('FORBIDDEN_NOT_OWNER', 'You can only delete notes you authored');
  }
  await pool.query(`DELETE FROM notes WHERE id = $1`, [noteId]);
}

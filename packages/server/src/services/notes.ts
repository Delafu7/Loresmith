// Session/lore notes. GM-only visibility layer (nav point 2) — a note's
// `visibility` column ('gm_only' | 'revealed_to_players' | 'owner_only')
// gates every read for a non-DM viewer, filtered in SQL (not a post-fetch
// JS pass), matching this codebase's existing "list-endpoint filtering
// belongs in the query" convention (see listDiceRolls). 'owner_only' reuses
// author_user_id as the owner — a note always has exactly one author
// already, so no separate owner column was added.

import type { Pool } from 'pg';
import { AppError, notFound } from '../middleware/errors.js';
import type { CampaignRole } from './authz.js';
import type { CreateNoteInput, UpdateNoteInput } from '../schemas/notes.js';

interface NoteRow {
  id: string;
  campaign_id: string;
  author_user_id: string;
  visibility: 'gm_only' | 'revealed_to_players' | 'owner_only';
  [key: string]: unknown;
}

// Non-DM visibility predicate, shared by every read below. Kept as a SQL
// fragment (not resolveVisibilitySync) since these are list/search queries,
// not a single already-fetched row — see the module header comment.
const PLAYER_VISIBILITY_CLAUSE = `(visibility = 'revealed_to_players' OR (visibility = 'owner_only' AND author_user_id = $ACTOR$))`;

async function fetchNoteScoped(pool: Pool, campaignId: string, noteId: string): Promise<NoteRow> {
  const result = await pool.query<NoteRow>(`SELECT * FROM notes WHERE id = $1 AND campaign_id = $2`, [noteId, campaignId]);
  const row = result.rows[0];
  if (!row) throw notFound('Note');
  return row;
}

function isVisibleTo(note: NoteRow, actorId: string, role: CampaignRole): boolean {
  if (role === 'dm') return true;
  if (note.visibility === 'revealed_to_players') return true;
  if (note.visibility === 'owner_only') return note.author_user_id === actorId;
  return false;
}

export async function listNotes(pool: Pool, campaignId: string, actorId: string, role: CampaignRole) {
  if (role === 'dm') {
    const result = await pool.query<NoteRow>(`SELECT * FROM notes WHERE campaign_id = $1 ORDER BY created_at DESC`, [campaignId]);
    return result.rows;
  }
  const result = await pool.query<NoteRow>(
    `SELECT * FROM notes WHERE campaign_id = $1 AND ${PLAYER_VISIBILITY_CLAUSE.replace('$ACTOR$', '$2')} ORDER BY created_at DESC`,
    [campaignId, actorId],
  );
  return result.rows;
}

// 404s (not 403) on a hidden note — matching this codebase's existing
// "don't confirm existence of hidden content to an unauthorized viewer"
// precedent (getEncounter's 'preparing'-status handling).
export async function getNote(pool: Pool, campaignId: string, noteId: string, actorId: string, role: CampaignRole) {
  const note = await fetchNoteScoped(pool, campaignId, noteId);
  if (!isVisibleTo(note, actorId, role)) throw notFound('Note');
  return note;
}

// Phase 3 "full-text search on notes" — plainto_tsquery (not to_tsquery)
// since this takes raw user input, never a caller-constructed tsquery
// expression; ts_rank orders best-match-first rather than the plain
// created_at-DESC every other notes list uses. Same SQL-level visibility
// filter as listNotes for a non-DM viewer.
export async function searchNotes(pool: Pool, campaignId: string, actorId: string, role: CampaignRole, query: string) {
  if (role === 'dm') {
    const result = await pool.query(
      `SELECT *, ts_rank(search_vector, plainto_tsquery('english', $2)) AS rank
       FROM notes
       WHERE campaign_id = $1 AND search_vector @@ plainto_tsquery('english', $2)
       ORDER BY rank DESC, created_at DESC`,
      [campaignId, query],
    );
    return result.rows;
  }
  const result = await pool.query(
    `SELECT *, ts_rank(search_vector, plainto_tsquery('english', $2)) AS rank
     FROM notes
     WHERE campaign_id = $1 AND search_vector @@ plainto_tsquery('english', $2)
       AND ${PLAYER_VISIBILITY_CLAUSE.replace('$ACTOR$', '$3')}
     ORDER BY rank DESC, created_at DESC`,
    [campaignId, query, actorId],
  );
  return result.rows;
}

// Default visibility at create time, when the caller doesn't pick one
// explicitly: mirrors the migration's backfill rule for consistency (a DM's
// notes are prep material by default; a player's notes were always visible
// to the whole campaign and this task never asked to change that for new
// player notes either).
function defaultVisibilityFor(role: CampaignRole): 'gm_only' | 'revealed_to_players' {
  return role === 'dm' ? 'gm_only' : 'revealed_to_players';
}

export async function createNote(
  pool: Pool,
  campaignId: string,
  actorId: string,
  role: CampaignRole,
  input: CreateNoteInput,
) {
  const result = await pool.query(
    `INSERT INTO notes (campaign_id, session_id, character_id, author_user_id, title, body, note_type, location_id, visibility)
     VALUES ($1,$2,$3,$4,$5,$6, COALESCE($7, 'note'), $8, $9)
     RETURNING *`,
    [
      campaignId, input.sessionId ?? null, input.characterId ?? null, actorId, input.title, input.body,
      input.noteType ?? null, input.locationId ?? null, input.visibility ?? defaultVisibilityFor(role),
    ],
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
    title: 'title', body: 'body', sessionId: 'session_id', characterId: 'character_id', noteType: 'note_type',
    locationId: 'location_id', visibility: 'visibility',
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

  // search_vector (Phase 3 "full-text search on notes") is a GENERATED
  // ALWAYS column — Postgres rejects an explicit INSERT into it, so it must
  // be omitted here the same way id/timestamps are, not copied like every
  // other column.
  const omit = new Set(['id', 'created_at', 'updated_at', 'search_vector']);
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

// Bulk reveal/hide for the notes page's multi-select bar (DM-only — the
// route gates this with requireRole('dm'), not just 'not-spectator', since
// bulk-changing visibility on notes a DM doesn't own is exactly the kind of
// action a player shouldn't be able to do even to their own notes in bulk;
// a player's per-note create/edit already covers their own single-note case).
export async function setNotesVisibilityBatch(
  pool: Pool,
  campaignId: string,
  noteIds: string[],
  visibility: 'gm_only' | 'revealed_to_players' | 'owner_only',
): Promise<NoteRow[]> {
  const result = await pool.query<NoteRow>(
    `UPDATE notes SET visibility = $1, updated_at = now()
     WHERE id = ANY($2::uuid[]) AND campaign_id = $3
     RETURNING *`,
    [visibility, noteIds, campaignId],
  );
  return result.rows;
}

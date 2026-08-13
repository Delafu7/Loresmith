// Integration test for the Phase 1 "full CRUD incl. duplicate" requirement
// on notes — proves duplicateNote (services/notes.ts) copies every column
// off a real row rather than a hand-maintained field list, and enforces the
// same owner-or-DM authorization as update/delete. Throwaway campaign/note
// fixtures, same isolation convention as characters.duplicate.integration.test.ts.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../db/pool.js';
import { duplicateNote } from './notes.js';
import { AppError } from '../middleware/errors.js';

describe('duplicateNote (integration, live DB, throwaway fixtures)', () => {
  let dmUserId: string;
  let authorUserId: string;
  let otherPlayerUserId: string;
  let campaignId: string;
  let noteId: string;

  beforeAll(async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const dmRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'Duplicate Test DM', 'x') RETURNING id`,
      [`duplicate-note-dm-${suffix}@example.test`],
    );
    dmUserId = dmRes.rows[0]!.id;

    const authorRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'Duplicate Test Author', 'x') RETURNING id`,
      [`duplicate-note-author-${suffix}@example.test`],
    );
    authorUserId = authorRes.rows[0]!.id;

    const otherRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'Duplicate Test Other Player', 'x') RETURNING id`,
      [`duplicate-note-other-${suffix}@example.test`],
    );
    otherPlayerUserId = otherRes.rows[0]!.id;

    const campaignRes = await pool.query<{ id: string }>(
      `INSERT INTO campaigns (name, dm_user_id, srd_edition) VALUES ('Duplicate Note Test Campaign', $1, '2024') RETURNING id`,
      [dmUserId],
    );
    campaignId = campaignRes.rows[0]!.id;
    await pool.query(`INSERT INTO campaign_members (campaign_id, user_id, role) VALUES ($1, $2, 'dm')`, [campaignId, dmUserId]);
    await pool.query(`INSERT INTO campaign_members (campaign_id, user_id, role) VALUES ($1, $2, 'player')`, [campaignId, authorUserId]);
    await pool.query(
      `INSERT INTO campaign_members (campaign_id, user_id, role) VALUES ($1, $2, 'player')`,
      [campaignId, otherPlayerUserId],
    );

    const noteRes = await pool.query<{ id: string }>(
      `INSERT INTO notes (campaign_id, author_user_id, title, body) VALUES ($1, $2, 'Original Note', 'Some lore text') RETURNING id`,
      [campaignId, authorUserId],
    );
    noteId = noteRes.rows[0]!.id;
  });

  afterAll(async () => {
    if (campaignId) await pool.query(`DELETE FROM campaigns WHERE id = $1`, [campaignId]);
    for (const id of [dmUserId, authorUserId, otherPlayerUserId]) {
      if (id) await pool.query(`DELETE FROM users WHERE id = $1`, [id]);
    }
    await pool.end();
  });

  it('the DM can duplicate any note, with a fresh id/timestamps, "(Copy)" suffix, and re-stamped author', async () => {
    const copy = await duplicateNote(pool, campaignId, noteId, dmUserId, 'dm');
    expect(copy.id).not.toBe(noteId);
    expect(copy.title).toBe('Original Note (Copy)');
    expect(copy.body).toBe('Some lore text');
    expect(copy.campaign_id).toBe(campaignId);
    expect(copy.author_user_id).toBe(dmUserId); // re-stamped to the actor, not the original author
    // GM-only visibility layer — the generic "copy every column" duplication
    // logic must carry `visibility` along for free, same as every other
    // column, without any special-cased handling in duplicateNote itself.
    expect(copy.visibility).toBe('gm_only');
    expect(new Date(copy.created_at as string).getTime()).toBeGreaterThan(0);
    expect(copy.created_at).not.toBe(undefined);
    expect(copy.updated_at).not.toBe(undefined);

    await pool.query(`DELETE FROM notes WHERE id = $1`, [copy.id]);
  });

  it('the note author can duplicate their own note', async () => {
    const copy = await duplicateNote(pool, campaignId, noteId, authorUserId, 'player');
    expect(copy.title).toBe('Original Note (Copy)');
    expect(copy.author_user_id).toBe(authorUserId);
    await pool.query(`DELETE FROM notes WHERE id = $1`, [copy.id]);
  });

  it('a different player cannot duplicate someone else\'s note', async () => {
    await expect(duplicateNote(pool, campaignId, noteId, otherPlayerUserId, 'player')).rejects.toThrow(AppError);
  });
});

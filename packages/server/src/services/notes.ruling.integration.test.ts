// Integration test for Phase 3 "rulings log" (notes.note_type discriminator,
// services/notes.ts's createNote/updateNote/duplicateNote). Throwaway
// campaign/note fixtures, same isolation convention as
// notes.duplicate.integration.test.ts.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../db/pool.js';
import { createNote, duplicateNote, searchNotes, updateNote } from './notes.js';

describe('note_type / rulings log (integration, live DB, throwaway fixtures)', () => {
  let dmUserId: string;
  let campaignId: string;

  beforeAll(async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const dmRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'Ruling Test DM', 'x') RETURNING id`,
      [`ruling-dm-${suffix}@example.test`],
    );
    dmUserId = dmRes.rows[0]!.id;

    const campaignRes = await pool.query<{ id: string }>(
      `INSERT INTO campaigns (name, dm_user_id, srd_edition) VALUES ('Ruling Test Campaign', $1, '2024') RETURNING id`,
      [dmUserId],
    );
    campaignId = campaignRes.rows[0]!.id;
  });

  afterAll(async () => {
    if (campaignId) await pool.query(`DELETE FROM campaigns WHERE id = $1`, [campaignId]);
    if (dmUserId) await pool.query(`DELETE FROM users WHERE id = $1`, [dmUserId]);
    await pool.end();
  });

  it('defaults to note_type "note" when omitted', async () => {
    const note = await createNote(pool, campaignId, dmUserId, 'dm', { title: 'Plain', body: 'Just a note.' });
    expect(note.note_type).toBe('note');
  });

  it('creates a ruling when noteType is explicitly set, and it is included in full-text search results', async () => {
    const ruling = await createNote(pool, campaignId, dmUserId, 'dm', {
      title: 'Grapple + prone interaction',
      body: 'A prone grappled creature can still be dragged.',
      noteType: 'ruling',
    });
    expect(ruling.note_type).toBe('ruling');

    const results = await searchNotes(pool, campaignId, 'grapple');
    expect(results.map((r) => r.id)).toContain(ruling.id);
  });

  it('updateNote can flip note_type from note to ruling', async () => {
    const note = await createNote(pool, campaignId, dmUserId, 'dm', { title: 'Reconsidered', body: 'Turned out to matter.' });
    expect(note.note_type).toBe('note');
    const updated = await updateNote(pool, campaignId, note.id as string, dmUserId, 'dm', { noteType: 'ruling' });
    expect((updated as Record<string, unknown>).note_type).toBe('ruling');
  });

  it('duplicateNote preserves note_type on the copy', async () => {
    const ruling = await createNote(pool, campaignId, dmUserId, 'dm', {
      title: 'Original ruling',
      body: 'Some ruling text.',
      noteType: 'ruling',
    });
    const copy = await duplicateNote(pool, campaignId, ruling.id as string, dmUserId, 'dm');
    expect((copy as Record<string, unknown>).note_type).toBe('ruling');
    await pool.query(`DELETE FROM notes WHERE id = $1`, [copy.id]);
  });
});

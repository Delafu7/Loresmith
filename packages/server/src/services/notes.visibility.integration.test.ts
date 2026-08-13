// GM-only visibility layer (nav point 2) — the core regression test for
// notes: a note's `visibility` column (reintroduced after the old
// `visible_to_players` boolean was removed entirely — see 1784269818666_
// add-notes-visibility.ts) must actually gate every read for a non-DM
// viewer, filtered at the SQL level (services/notes.ts's listNotes/getNote/
// searchNotes). Asserted at the payload level (the raw service return
// value), per this codebase's existing methodology for this class of test.
// Throwaway campaign/user/note fixtures, same isolation convention as
// notes.duplicate.integration.test.ts.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../db/pool.js';
import { createNote, getNote, listNotes } from './notes.js';
import { AppError } from '../middleware/errors.js';

describe('notes visibility (integration, live DB, throwaway fixtures)', () => {
  let dmUserId: string;
  let authorUserId: string;
  let otherPlayerUserId: string;
  let campaignId: string;
  let gmOnlyNoteId: string;
  let revealedNoteId: string;
  let ownerOnlyNoteId: string;

  beforeAll(async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const dmRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'Notes Visibility Test DM', 'x') RETURNING id`,
      [`notes-visibility-dm-${suffix}@example.test`],
    );
    dmUserId = dmRes.rows[0]!.id;

    const authorRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'Notes Visibility Test Author', 'x') RETURNING id`,
      [`notes-visibility-author-${suffix}@example.test`],
    );
    authorUserId = authorRes.rows[0]!.id;

    const otherRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'Notes Visibility Test Other Player', 'x') RETURNING id`,
      [`notes-visibility-other-${suffix}@example.test`],
    );
    otherPlayerUserId = otherRes.rows[0]!.id;

    const campaignRes = await pool.query<{ id: string }>(
      `INSERT INTO campaigns (name, dm_user_id, srd_edition) VALUES ('Notes Visibility Test Campaign', $1, '2024') RETURNING id`,
      [dmUserId],
    );
    campaignId = campaignRes.rows[0]!.id;
    await pool.query(`INSERT INTO campaign_members (campaign_id, user_id, role) VALUES ($1, $2, 'dm')`, [campaignId, dmUserId]);
    await pool.query(`INSERT INTO campaign_members (campaign_id, user_id, role) VALUES ($1, $2, 'player')`, [campaignId, authorUserId]);
    await pool.query(
      `INSERT INTO campaign_members (campaign_id, user_id, role) VALUES ($1, $2, 'player')`,
      [campaignId, otherPlayerUserId],
    );

    const gmOnly = await createNote(pool, campaignId, dmUserId, 'dm', { title: 'DM Prep', body: 'Secret plot twist.' });
    gmOnlyNoteId = gmOnly.id as string;

    const revealed = await createNote(pool, campaignId, dmUserId, 'dm', {
      title: 'Public Lore',
      body: 'Everyone knows this.',
      visibility: 'revealed_to_players',
    });
    revealedNoteId = revealed.id as string;

    const ownerOnly = await createNote(pool, campaignId, authorUserId, 'player', {
      title: 'My Private Journal',
      body: "Only I should see this.",
      visibility: 'owner_only',
    });
    ownerOnlyNoteId = ownerOnly.id as string;
  });

  afterAll(async () => {
    if (campaignId) await pool.query(`DELETE FROM campaigns WHERE id = $1`, [campaignId]);
    for (const id of [dmUserId, authorUserId, otherPlayerUserId]) {
      if (id) await pool.query(`DELETE FROM users WHERE id = $1`, [id]);
    }
    await pool.end();
  });

  it('the DM sees every note regardless of visibility', async () => {
    const rows = await listNotes(pool, campaignId, dmUserId, 'dm');
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(gmOnlyNoteId);
    expect(ids).toContain(revealedNoteId);
    expect(ids).toContain(ownerOnlyNoteId);
  });

  it('a DM-authored note defaults to gm_only when no visibility is given', async () => {
    const rows = await listNotes(pool, campaignId, dmUserId, 'dm');
    const note = rows.find((r) => r.id === gmOnlyNoteId)!;
    expect(note.visibility).toBe('gm_only');
  });

  it("a player's list never contains a gm_only note", async () => {
    const rows = await listNotes(pool, campaignId, otherPlayerUserId, 'player');
    const ids = rows.map((r) => r.id);
    expect(ids).not.toContain(gmOnlyNoteId);
    expect(ids).toContain(revealedNoteId);
  });

  it("a player's list never contains another player's owner_only note", async () => {
    const rows = await listNotes(pool, campaignId, otherPlayerUserId, 'player');
    expect(rows.map((r) => r.id)).not.toContain(ownerOnlyNoteId);
  });

  it('the owning player DOES see their own owner_only note', async () => {
    const rows = await listNotes(pool, campaignId, authorUserId, 'player');
    expect(rows.map((r) => r.id)).toContain(ownerOnlyNoteId);
  });

  it('getNote 404s (not just omits) a gm_only note for a non-DM viewer — no existence leak', async () => {
    await expect(getNote(pool, campaignId, gmOnlyNoteId, otherPlayerUserId, 'player')).rejects.toBeInstanceOf(AppError);
    await expect(getNote(pool, campaignId, gmOnlyNoteId, otherPlayerUserId, 'player')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('getNote 404s an owner_only note for a non-owner player but succeeds for the DM and the owner', async () => {
    await expect(getNote(pool, campaignId, ownerOnlyNoteId, otherPlayerUserId, 'player')).rejects.toBeInstanceOf(AppError);
    await expect(getNote(pool, campaignId, ownerOnlyNoteId, dmUserId, 'dm')).resolves.toMatchObject({ id: ownerOnlyNoteId });
    await expect(getNote(pool, campaignId, ownerOnlyNoteId, authorUserId, 'player')).resolves.toMatchObject({ id: ownerOnlyNoteId });
  });

  it('a player-authored note with no explicit visibility defaults to revealed_to_players', async () => {
    const note = await createNote(pool, campaignId, authorUserId, 'player', { title: 'Party Notes', body: 'Shared with everyone.' });
    expect(note.visibility).toBe('revealed_to_players');
    await pool.query(`DELETE FROM notes WHERE id = $1`, [note.id]);
  });
});

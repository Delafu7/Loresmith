// Integration test for Phase 3 "full-text search on notes"
// (services/notes.ts's searchNotes, notes.search_vector generated column +
// GIN index). Throwaway campaign/note fixtures, same isolation convention
// as notes.duplicate.integration.test.ts.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../db/pool.js';
import { searchNotes } from './notes.js';

describe('searchNotes (integration, live DB, throwaway fixtures)', () => {
  let dmUserId: string;
  let campaignId: string;
  let dragonNoteId: string;
  let tavernNoteId: string;

  beforeAll(async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const dmRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'Notes Search Test DM', 'x') RETURNING id`,
      [`notes-search-dm-${suffix}@example.test`],
    );
    dmUserId = dmRes.rows[0]!.id;

    const campaignRes = await pool.query<{ id: string }>(
      `INSERT INTO campaigns (name, dm_user_id, srd_edition) VALUES ('Notes Search Test Campaign', $1, '2024') RETURNING id`,
      [dmUserId],
    );
    campaignId = campaignRes.rows[0]!.id;

    const dragonRes = await pool.query<{ id: string }>(
      `INSERT INTO notes (campaign_id, author_user_id, title, body)
       VALUES ($1, $2, 'The Red Dragon', 'An ancient red dragon sleeps beneath the mountain, hoarding gold.')
       RETURNING id`,
      [campaignId, dmUserId],
    );
    dragonNoteId = dragonRes.rows[0]!.id;

    const tavernRes = await pool.query<{ id: string }>(
      `INSERT INTO notes (campaign_id, author_user_id, title, body)
       VALUES ($1, $2, 'The Prancing Pony', 'A cozy tavern where the party first met their contact.')
       RETURNING id`,
      [campaignId, dmUserId],
    );
    tavernNoteId = tavernRes.rows[0]!.id;
  });

  afterAll(async () => {
    if (campaignId) await pool.query(`DELETE FROM campaigns WHERE id = $1`, [campaignId]);
    if (dmUserId) await pool.query(`DELETE FROM users WHERE id = $1`, [dmUserId]);
    await pool.end();
  });

  it('matches a note by a word in its title', async () => {
    const results = await searchNotes(pool, campaignId, dmUserId, 'dm', 'dragon');
    expect(results.map((r) => r.id)).toEqual([dragonNoteId]);
  });

  it('matches a note by a word in its body, not just the title', async () => {
    const results = await searchNotes(pool, campaignId, dmUserId, 'dm', 'tavern');
    expect(results.map((r) => r.id)).toEqual([tavernNoteId]);
  });

  it('stems the query — "sleeping" still matches "sleeps"', async () => {
    const results = await searchNotes(pool, campaignId, dmUserId, 'dm', 'sleeping');
    expect(results.map((r) => r.id)).toEqual([dragonNoteId]);
  });

  it('returns nothing for a query that matches neither note', async () => {
    const results = await searchNotes(pool, campaignId, dmUserId, 'dm', 'spaceship');
    expect(results).toHaveLength(0);
  });

  it('is scoped to the campaign — a search in an unrelated campaign never returns these notes', async () => {
    const otherCampaignRes = await pool.query<{ id: string }>(
      `INSERT INTO campaigns (name, dm_user_id, srd_edition) VALUES ('Other Search Test Campaign', $1, '2024') RETURNING id`,
      [dmUserId],
    );
    const otherCampaignId = otherCampaignRes.rows[0]!.id;
    try {
      const results = await searchNotes(pool, otherCampaignId, dmUserId, 'dm', 'dragon');
      expect(results).toHaveLength(0);
    } finally {
      await pool.query(`DELETE FROM campaigns WHERE id = $1`, [otherCampaignId]);
    }
  });

  // GM-only visibility layer — a non-DM viewer's search never returns a
  // gm_only note, even when the query text matches it.
  it('never returns a gm_only note to a non-DM viewer, even on a matching query', async () => {
    const playerRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'Notes Search Test Player', 'x') RETURNING id`,
      [`notes-search-player-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`],
    );
    const playerUserId = playerRes.rows[0]!.id;
    await pool.query(`INSERT INTO campaign_members (campaign_id, user_id, role) VALUES ($1, $2, 'player')`, [campaignId, playerUserId]);
    try {
      const results = await searchNotes(pool, campaignId, playerUserId, 'player', 'dragon');
      expect(results).toHaveLength(0);
    } finally {
      await pool.query(`DELETE FROM campaign_members WHERE campaign_id = $1 AND user_id = $2`, [campaignId, playerUserId]);
      await pool.query(`DELETE FROM users WHERE id = $1`, [playerUserId]);
    }
  });
});

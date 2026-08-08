// Integration test for the Iteration 4 campaign reference notes — a
// dedicated, always-GM-only per-campaign scratchpad (see the migration's
// header comment for why it isn't a reuse of notes.ts or the removed
// hide/reveal engine). Covers: empty default before any save, persisting a
// change, isolation between campaigns, and that this file's service layer
// has no player-visible branch at all (the DM-only enforcement itself
// lives at the route layer via requireRole('dm') — this test locks in the
// service's own data shape/isolation, mirroring campaignBestiary.integration.
// test.ts's split of concerns). Throwaway campaign/user fixtures.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../db/pool.js';
import { getReferenceNotes, updateReferenceNotes } from './campaignReference.js';

describe('campaign reference notes (integration, live DB, throwaway fixtures)', () => {
  let dmUserId: string;
  let campaignId: string;
  let otherCampaignId: string;

  beforeAll(async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const dmRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'Reference Notes Test DM', 'x') RETURNING id`,
      [`reference-notes-dm-${suffix}@example.test`],
    );
    dmUserId = dmRes.rows[0]!.id;

    const campaignRes = await pool.query<{ id: string }>(
      `INSERT INTO campaigns (name, dm_user_id, srd_edition) VALUES ('Reference Notes Test Campaign', $1, '2024') RETURNING id`,
      [dmUserId],
    );
    campaignId = campaignRes.rows[0]!.id;

    const otherCampaignRes = await pool.query<{ id: string }>(
      `INSERT INTO campaigns (name, dm_user_id, srd_edition) VALUES ('Reference Notes Test Other Campaign', $1, '2024') RETURNING id`,
      [dmUserId],
    );
    otherCampaignId = otherCampaignRes.rows[0]!.id;
  });

  afterAll(async () => {
    if (campaignId) await pool.query(`DELETE FROM campaigns WHERE id = $1`, [campaignId]);
    if (otherCampaignId) await pool.query(`DELETE FROM campaigns WHERE id = $1`, [otherCampaignId]);
    if (dmUserId) await pool.query(`DELETE FROM users WHERE id = $1`, [dmUserId]);
    await pool.end();
  });

  it('a campaign with nothing saved yet returns an empty default, not an error', async () => {
    const notes = await getReferenceNotes(pool, campaignId);
    expect(notes.body).toBe('');
    expect(notes.updated_at).toBeNull();
  });

  it('persists a change and returns it on the next read', async () => {
    const updated = await updateReferenceNotes(pool, campaignId, 'Long rest: full HP + half hit dice.\nThe old mill: 3 days north.');
    expect(updated.body).toBe('Long rest: full HP + half hit dice.\nThe old mill: 3 days north.');
    expect(updated.updated_at).not.toBeNull();

    const reread = await getReferenceNotes(pool, campaignId);
    expect(reread.body).toBe(updated.body);
  });

  it('a second save overwrites (not appends to) the same campaign\'s notes', async () => {
    await updateReferenceNotes(pool, campaignId, 'Replaced entirely.');
    const notes = await getReferenceNotes(pool, campaignId);
    expect(notes.body).toBe('Replaced entirely.');
  });

  it('another campaign\'s notes stay isolated', async () => {
    await updateReferenceNotes(pool, otherCampaignId, 'Other campaign only.');
    const thisOne = await getReferenceNotes(pool, campaignId);
    const otherOne = await getReferenceNotes(pool, otherCampaignId);
    expect(thisOne.body).toBe('Replaced entirely.');
    expect(otherOne.body).toBe('Other campaign only.');
  });
});

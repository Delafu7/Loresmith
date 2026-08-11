// Integration test for Phase 3 "plot threads" (services/plotThreads.ts) —
// covers DM-only CRUD, the per-user entity_visibility gate (a player only
// ever sees a thread once granted, never before), touch bumping
// last_touched_at, and status transitions. Throwaway campaign/user
// fixtures, same isolation convention as encounters.visibility.integration.test.ts.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../db/pool.js';
import { AppError } from '../middleware/errors.js';
import {
  createPlotThread,
  deletePlotThread,
  listPlotThreads,
  setPlotThreadVisibility,
  touchPlotThread,
  updatePlotThread,
} from './plotThreads.js';

describe('plot threads (integration, live DB, throwaway fixtures)', () => {
  let dmUserId: string;
  let playerAUserId: string;
  let playerBUserId: string;
  let campaignId: string;

  beforeAll(async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const dmRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'Plot Thread Test DM', 'x') RETURNING id`,
      [`plot-thread-dm-${suffix}@example.test`],
    );
    dmUserId = dmRes.rows[0]!.id;

    const playerARes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'Plot Thread Test Player A', 'x') RETURNING id`,
      [`plot-thread-player-a-${suffix}@example.test`],
    );
    playerAUserId = playerARes.rows[0]!.id;

    const playerBRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'Plot Thread Test Player B', 'x') RETURNING id`,
      [`plot-thread-player-b-${suffix}@example.test`],
    );
    playerBUserId = playerBRes.rows[0]!.id;

    const campaignRes = await pool.query<{ id: string }>(
      `INSERT INTO campaigns (name, dm_user_id, srd_edition) VALUES ('Plot Thread Test Campaign', $1, '2024') RETURNING id`,
      [dmUserId],
    );
    campaignId = campaignRes.rows[0]!.id;
    await pool.query(`INSERT INTO campaign_members (campaign_id, user_id, role) VALUES ($1, $2, 'dm')`, [campaignId, dmUserId]);
    await pool.query(`INSERT INTO campaign_members (campaign_id, user_id, role) VALUES ($1, $2, 'player')`, [campaignId, playerAUserId]);
    await pool.query(`INSERT INTO campaign_members (campaign_id, user_id, role) VALUES ($1, $2, 'player')`, [campaignId, playerBUserId]);
  });

  afterAll(async () => {
    if (campaignId) await pool.query(`DELETE FROM campaigns WHERE id = $1`, [campaignId]);
    for (const id of [dmUserId, playerAUserId, playerBUserId]) {
      if (id) await pool.query(`DELETE FROM users WHERE id = $1`, [id]);
    }
    await pool.end();
  });

  it('a non-DM cannot create a plot thread', async () => {
    await expect(
      createPlotThread(pool, campaignId, 'player', { title: 'Should fail' }),
    ).rejects.toBeInstanceOf(AppError);
  });

  it('a thread starts hidden from every player until explicitly shared', async () => {
    const thread = await createPlotThread(pool, campaignId, 'dm', { title: 'The Missing Heir', description: 'Who is the true king?' });

    const dmList = await listPlotThreads(pool, campaignId, dmUserId, 'dm');
    expect(dmList.map((t) => t.id)).toContain(thread.id);
    expect(dmList.find((t) => t.id === thread.id)?.visibleToUserIds).toEqual([]);

    const playerAList = await listPlotThreads(pool, campaignId, playerAUserId, 'player');
    expect(playerAList.map((t) => t.id)).not.toContain(thread.id);

    await setPlotThreadVisibility(pool, campaignId, thread.id, 'dm', { userIds: [playerAUserId] });

    const playerAAfter = await listPlotThreads(pool, campaignId, playerAUserId, 'player');
    expect(playerAAfter.map((t) => t.id)).toContain(thread.id);

    const playerBAfter = await listPlotThreads(pool, campaignId, playerBUserId, 'player');
    expect(playerBAfter.map((t) => t.id)).not.toContain(thread.id);

    const dmAfter = await listPlotThreads(pool, campaignId, dmUserId, 'dm');
    expect(dmAfter.find((t) => t.id === thread.id)?.visibleToUserIds).toEqual([playerAUserId]);
  });

  it('setPlotThreadVisibility replaces the full grant set, not additive', async () => {
    const thread = await createPlotThread(pool, campaignId, 'dm', { title: 'Replace Test' });
    await setPlotThreadVisibility(pool, campaignId, thread.id, 'dm', { userIds: [playerAUserId, playerBUserId] });
    await setPlotThreadVisibility(pool, campaignId, thread.id, 'dm', { userIds: [playerBUserId] });

    const dmView = await listPlotThreads(pool, campaignId, dmUserId, 'dm');
    expect(dmView.find((t) => t.id === thread.id)?.visibleToUserIds).toEqual([playerBUserId]);
  });

  it('updatePlotThread bumps last_touched_at and can change status', async () => {
    const thread = await createPlotThread(pool, campaignId, 'dm', { title: 'Status Test' });
    expect(thread.status).toBe('open');

    await new Promise((resolve) => setTimeout(resolve, 10));
    const updated = await updatePlotThread(pool, campaignId, thread.id, 'dm', { status: 'resolved' });
    expect(updated.status).toBe('resolved');
    expect(new Date(updated.last_touched_at).getTime()).toBeGreaterThan(new Date(thread.last_touched_at).getTime());
  });

  it('touchPlotThread bumps last_touched_at without changing content', async () => {
    const thread = await createPlotThread(pool, campaignId, 'dm', { title: 'Touch Test', description: 'Original.' });
    await new Promise((resolve) => setTimeout(resolve, 10));
    const touched = await touchPlotThread(pool, campaignId, thread.id, 'dm');
    expect(touched.description).toBe('Original.');
    expect(new Date(touched.last_touched_at).getTime()).toBeGreaterThan(new Date(thread.last_touched_at).getTime());
  });

  it('deletePlotThread removes the thread and a non-DM cannot delete', async () => {
    const thread = await createPlotThread(pool, campaignId, 'dm', { title: 'Delete Test' });
    await expect(deletePlotThread(pool, campaignId, thread.id, 'player')).rejects.toBeInstanceOf(AppError);
    await deletePlotThread(pool, campaignId, thread.id, 'dm');
    const dmList = await listPlotThreads(pool, campaignId, dmUserId, 'dm');
    expect(dmList.map((t) => t.id)).not.toContain(thread.id);
  });
});

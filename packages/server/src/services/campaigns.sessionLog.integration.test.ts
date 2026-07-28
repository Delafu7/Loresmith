// Integration test for the Phase 1 "full CRUD" requirement on session log
// entries (services/campaigns.ts's listSessionLogs/getSessionLog/
// createSessionLog/updateSessionLog/deleteSessionLog). DM-only write
// authorization is enforced entirely at the route layer
// (routes/campaigns.ts's requireRole('dm') on POST/PATCH/DELETE) — these
// service functions take no actor/role param at all, so this test calls them
// directly with no role checks, same as every other integration test in this
// codebase that targets a service whose authorization lives in middleware.
// Throwaway campaign/user/session fixtures, same isolation convention as
// assets.updateTitle.integration.test.ts.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../db/pool.js';
import {
  createSessionLog,
  deleteSessionLog,
  getSessionLog,
  listSessionLogs,
  updateSessionLog,
} from './campaigns.js';
import { AppError } from '../middleware/errors.js';

describe('session log CRUD (integration, live DB, throwaway fixtures)', () => {
  let dmUserId: string;
  let campaignId: string;

  beforeAll(async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const dmRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'Session Log Test DM', 'x') RETURNING id`,
      [`session-log-dm-${suffix}@example.test`],
    );
    dmUserId = dmRes.rows[0]!.id;

    const campaignRes = await pool.query<{ id: string }>(
      `INSERT INTO campaigns (name, dm_user_id, srd_edition) VALUES ('Session Log Test Campaign', $1, '2024') RETURNING id`,
      [dmUserId],
    );
    campaignId = campaignRes.rows[0]!.id;
    await pool.query(`INSERT INTO campaign_members (campaign_id, user_id, role) VALUES ($1, $2, 'dm')`, [campaignId, dmUserId]);
  });

  afterAll(async () => {
    if (campaignId) await pool.query(`DELETE FROM campaigns WHERE id = $1`, [campaignId]);
    if (dmUserId) await pool.query(`DELETE FROM users WHERE id = $1`, [dmUserId]);
    await pool.end();
  });

  it('creates, lists, gets, updates, and deletes a session log entry', async () => {
    const created = await createSessionLog(pool, campaignId, {
      sessionNumber: 1,
      title: 'The Beginning',
      playedAt: '2026-01-05',
      recap: 'The party met in a tavern.',
    });
    expect(created.session_number).toBe(1);
    expect(created.title).toBe('The Beginning');

    const list = await listSessionLogs(pool, campaignId);
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe(created.id);

    const fetched = await getSessionLog(pool, campaignId, created.id);
    expect(fetched.id).toBe(created.id);

    const updated = await updateSessionLog(pool, campaignId, created.id, { title: 'The Beginning (revised)' });
    expect(updated.title).toBe('The Beginning (revised)');

    await deleteSessionLog(pool, campaignId, created.id);
    await expect(getSessionLog(pool, campaignId, created.id)).rejects.toThrow(AppError);
  });

  it('rejects a duplicate session number with a clean AppError', async () => {
    await createSessionLog(pool, campaignId, { sessionNumber: 5 });
    await expect(createSessionLog(pool, campaignId, { sessionNumber: 5 })).rejects.toThrow(AppError);
    await expect(createSessionLog(pool, campaignId, { sessionNumber: 5 })).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });

  it('moves updated_at on update while leaving created_at untouched', async () => {
    const created = await createSessionLog(pool, campaignId, { sessionNumber: 6 });
    const originalCreatedAt = created.created_at;
    const originalUpdatedAt = created.updated_at;

    await new Promise((resolve) => setTimeout(resolve, 10));
    const updated = await updateSessionLog(pool, campaignId, created.id, { recap: 'Updated recap.' });

    expect(updated.created_at).toEqual(originalCreatedAt);
    expect(new Date(updated.updated_at).getTime()).toBeGreaterThan(new Date(originalUpdatedAt).getTime());
  });
});

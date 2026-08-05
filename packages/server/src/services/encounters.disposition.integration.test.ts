// Integration test for encounter-level disposition transitions:
// - defaults to 'neutral' on a freshly created encounter.
// - transitionDisposition updates the row, logs a history event with the
//   correct from/to/changed-by, and rejects a no-op transition.
// - listDispositionEvents returns history newest-first.
// Throwaway campaign/user/encounter fixtures, same isolation convention as
// encounters.visibility.integration.test.ts — never touches the seeded demo
// campaign.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../db/pool.js';
import { AppError } from '../middleware/errors.js';
import { listDispositionEvents, transitionDisposition } from './encounters.js';

describe('encounter disposition (integration, live DB, throwaway fixtures)', () => {
  let dmUserId: string;
  let campaignId: string;
  let encounterId: string;

  beforeAll(async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const dmRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'Disposition Test DM', 'x') RETURNING id`,
      [`disposition-dm-${suffix}@example.test`],
    );
    dmUserId = dmRes.rows[0]!.id;

    const campaignRes = await pool.query<{ id: string }>(
      `INSERT INTO campaigns (name, dm_user_id, srd_edition) VALUES ('Disposition Test Campaign', $1, '2024') RETURNING id`,
      [dmUserId],
    );
    campaignId = campaignRes.rows[0]!.id;
    await pool.query(`INSERT INTO campaign_members (campaign_id, user_id, role) VALUES ($1, $2, 'dm')`, [campaignId, dmUserId]);

    const encounterRes = await pool.query<{ id: string }>(
      `INSERT INTO encounters (campaign_id, name, status) VALUES ($1, 'Disposition Test Encounter', 'preparing') RETURNING id`,
      [campaignId],
    );
    encounterId = encounterRes.rows[0]!.id;
  });

  afterAll(async () => {
    try {
      if (campaignId) await pool.query(`DELETE FROM campaigns WHERE id = $1`, [campaignId]);
    } finally {
      if (dmUserId) await pool.query(`DELETE FROM users WHERE id = $1`, [dmUserId]);
      await pool.end();
    }
  });

  it('defaults to neutral on a freshly created encounter', async () => {
    const result = await pool.query<{ disposition: string }>(`SELECT disposition FROM encounters WHERE id = $1`, [encounterId]);
    expect(result.rows[0]!.disposition).toBe('neutral');
  });

  it('transitions disposition, bumps sync_seq, and logs a history event', async () => {
    const before = await pool.query<{ sync_seq: number }>(`SELECT sync_seq FROM encounters WHERE id = $1`, [encounterId]);

    const { encounter, event } = await transitionDisposition(
      pool,
      encounterId,
      { toDisposition: 'friendly', note: 'The envoy offers terms.' },
      dmUserId,
    );

    expect(encounter.disposition).toBe('friendly');
    expect(encounter.sync_seq).toBe(before.rows[0]!.sync_seq + 1);
    expect(event.from_disposition).toBe('neutral');
    expect(event.to_disposition).toBe('friendly');
    expect(event.changed_by_user_id).toBe(dmUserId);
    expect(event.note).toBe('The envoy offers terms.');
  });

  it('rejects a no-op transition (toDisposition === current disposition)', async () => {
    await expect(
      transitionDisposition(pool, encounterId, { toDisposition: 'friendly' }, dmUserId),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(
      transitionDisposition(pool, encounterId, { toDisposition: 'friendly' }, dmUserId),
    ).rejects.toBeInstanceOf(AppError);
  });

  it('records a further transition and returns history newest-first', async () => {
    await transitionDisposition(pool, encounterId, { toDisposition: 'hostile', note: 'The negotiation collapses.' }, dmUserId);

    const events = await listDispositionEvents(pool, encounterId);
    expect(events.length).toBeGreaterThanOrEqual(2);
    expect(events[0]!.to_disposition).toBe('hostile');
    expect(events[0]!.from_disposition).toBe('friendly');
    expect(new Date(events[0]!.created_at).getTime()).toBeGreaterThanOrEqual(new Date(events[1]!.created_at).getTime());
  });

  it('throws NOT_FOUND for an encounter id that does not exist', async () => {
    await expect(
      transitionDisposition(pool, '00000000-0000-0000-0000-000000000000', { toDisposition: 'hostile' }, dmUserId),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

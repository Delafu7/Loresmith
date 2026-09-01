// docs/roadmap/dnd-2024-gap-analysis.md P3-2 (ER-07) — the stateless Travel
// Pace calculator, exercised through its service so the campaign's
// srd_edition is really resolved from the DB and drives the edition-branched
// output. Pure-function math itself is covered in domain/travelPace.test.ts;
// this file only proves the wiring (edition lookup, missing-campaign 404) and
// the one-line-diff-worthy divergence: the SAME query returns a different
// plan for a 2014 vs a 2024 campaign. Throwaway campaign/user fixtures, same
// isolation convention as encounters.surprise.integration.test.ts.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../db/pool.js';
import { computeCampaignTravelPlan } from './travelPace.js';

describe('computeCampaignTravelPlan (integration, live DB, throwaway fixtures)', () => {
  let userId: string;
  let campaign2014Id: string;
  let campaign2024Id: string;

  beforeAll(async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const userRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'Travel Pace Test User', 'x') RETURNING id`,
      [`travel-pace-${suffix}@example.test`],
    );
    userId = userRes.rows[0]!.id;

    const c2014 = await pool.query<{ id: string }>(
      `INSERT INTO campaigns (name, dm_user_id, srd_edition) VALUES ('Travel Pace 2014', $1, '2014') RETURNING id`,
      [userId],
    );
    campaign2014Id = c2014.rows[0]!.id;
    const c2024 = await pool.query<{ id: string }>(
      `INSERT INTO campaigns (name, dm_user_id, srd_edition) VALUES ('Travel Pace 2024', $1, '2024') RETURNING id`,
      [userId],
    );
    campaign2024Id = c2024.rows[0]!.id;
  });

  afterAll(async () => {
    if (campaign2014Id) await pool.query(`DELETE FROM campaigns WHERE id = $1`, [campaign2014Id]);
    if (campaign2024Id) await pool.query(`DELETE FROM campaigns WHERE id = $1`, [campaign2024Id]);
    if (userId) await pool.query(`DELETE FROM users WHERE id = $1`, [userId]);
    await pool.end();
  });

  it('resolves the campaign edition and branches pace effects on it', async () => {
    const query = { pace: 'fast' as const, hours: 6 };

    const plan2014 = await computeCampaignTravelPlan(pool, campaign2014Id, query);
    expect(plan2014.edition).toBe('2014');
    expect(plan2014.paceEffects.passivePerceptionModifier).toBe(-5);
    expect(plan2014.paceEffects.disadvantage).toEqual([]);

    const plan2024 = await computeCampaignTravelPlan(pool, campaign2024Id, query);
    expect(plan2024.edition).toBe('2024');
    expect(plan2024.paceEffects.passivePerceptionModifier).toBe(0);
    expect(plan2024.paceEffects.disadvantage).toContain('Wisdom (Survival)');

    // Distance table is identical across editions.
    expect(plan2014.distance.miles).toBe(24);
    expect(plan2024.distance.miles).toBe(24);
  });

  it('branches forced march on edition: 2014 schedules saves, 2024 never does', async () => {
    const query = { pace: 'normal' as const, hours: 11 };

    const plan2014 = await computeCampaignTravelPlan(pool, campaign2014Id, query);
    expect(plan2014.forcedMarch.applies).toBe(true);
    expect(plan2014.forcedMarch.saves).toEqual([
      { hour: 9, dc: 11 },
      { hour: 10, dc: 12 },
      { hour: 11, dc: 13 },
    ]);

    const plan2024 = await computeCampaignTravelPlan(pool, campaign2024Id, query);
    expect(plan2024.forcedMarch.applies).toBe(false);
    expect(plan2024.forcedMarch.saves).toEqual([]);
  });

  it('404s for an unknown campaign', async () => {
    await expect(
      computeCampaignTravelPlan(pool, '00000000-0000-0000-0000-000000000000', { pace: 'fast', hours: 4 }),
    ).rejects.toThrow(/not found/i);
  });
});

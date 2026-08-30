// docs/roadmap/dnd-2024-gap-analysis.md P1-4 (FT-01) — locks in the feat
// catalog completeness fix in db/seeds/catalog.ts: 75 official 2024 feats
// (10 Origin + 43 General + 10 Fighting Style + 12 Epic Boon, corrected here
// against the actual PHB text — the gap analysis's original "69 total, 37
// General" estimate was stale), with a `type` column backfilled for all of
// them. Read-only against the live seeded DB, same "no fixtures needed"
// convention as catalog.speciesCompleteness.integration.test.ts.

import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { pool } from '../db/pool.js';
import { listFeats } from './catalog.js';

const noopActorUserId = crypto.randomUUID();

describe('2024 feat catalog completeness (integration, live seeded DB)', () => {
  it('has exactly 75 official 2024 feats', async () => {
    const feats = await listFeats(pool, { edition: '2024' }, noopActorUserId);
    expect(feats.length).toBe(75);
  });

  it('the four categories match docs/players-handbook-2024/Chapter 5 exactly: 10/43/10/12', async () => {
    const feats = await listFeats(pool, { edition: '2024' }, noopActorUserId);
    const counts = feats.reduce<Record<string, number>>((acc, f) => {
      const type = f.type as string;
      acc[type] = (acc[type] ?? 0) + 1;
      return acc;
    }, {});
    expect(counts).toEqual({ origin: 10, general: 43, fighting_style: 10, epic_boon: 12 });
  });

  it('every feat has a type in 2024 (no unclassified rows)', async () => {
    const feats = await listFeats(pool, { edition: '2024' }, noopActorUserId);
    expect(feats.every((f) => f.type !== null)).toBe(true);
  });

  it("2014's Grappler predates the type categorization and is left unclassified, not force-fit into a 2024 bucket", async () => {
    const feats2014 = await listFeats(pool, { edition: '2014' }, noopActorUserId);
    const grappler = feats2014.find((f) => f.index_key === 'grappler');
    expect(grappler).toBeDefined();
    expect(grappler!.type).toBeNull();
  });

  it('every one of the 4 seeded 2024 backgrounds can resolve its granted feat by index key', async () => {
    const backgrounds = await pool.query<{ index_key: string; granted_feat_id: string | null }>(
      `SELECT index_key, granted_feat_id FROM backgrounds WHERE edition_scope = '2024'`,
    );
    expect(backgrounds.rows.length).toBeGreaterThan(0);
    for (const bg of backgrounds.rows) {
      expect(bg.granted_feat_id, `background '${bg.index_key}' has no granted_feat_id`).not.toBeNull();
      const feat = await pool.query(`SELECT 1 FROM feats WHERE id = $1`, [bg.granted_feat_id]);
      expect(feat.rowCount, `background '${bg.index_key}'s granted_feat_id doesn't resolve to a real feat`).toBe(1);
    }
  });
});

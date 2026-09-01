// docs/roadmap/dnd-2024-gap-analysis.md P2-7 (CC-04) — locks in the seed
// data the wizard's trinket step depends on: the full 100-entry 2024 PHB
// Trinkets table, seeded as items.item_type='trinket' rows. Catalog-
// completeness style, read-only against the live seeded DB, no fixtures —
// matches catalog.weaponMasteryCompleteness.integration.test.ts's pattern.

import { afterAll, describe, expect, it } from 'vitest';
import { pool } from '../db/pool.js';

afterAll(async () => {
  await pool.end();
});

describe('trinket catalog completeness (integration, live seeded DB)', () => {
  it('has all 100 trinkets from the 2024 PHB Trinkets table', async () => {
    const result = await pool.query<{ slug: string }>(
      `SELECT slug FROM items WHERE item_type = 'trinket' AND edition_scope = '2024'`,
    );
    expect(result.rows).toHaveLength(100);
  });

  it('every trinket has a non-empty description and is free/weightless (no cost, no weight)', async () => {
    const result = await pool.query<{ slug: string; description: string | null; weight_lb: number | null; cost_cp: number | null }>(
      `SELECT slug, description, weight_lb, cost_cp FROM items WHERE item_type = 'trinket'`,
    );
    expect(result.rows.length).toBeGreaterThan(0);
    for (const row of result.rows) {
      expect(row.description, `trinket '${row.slug}' has no description`).toBeTruthy();
      expect(Number(row.weight_lb), `trinket '${row.slug}' should be weightless`).toBe(0);
      expect(row.cost_cp, `trinket '${row.slug}' should cost nothing`).toBe(0);
    }
  });

  it('the first and last (roll "00") trinkets match the source table exactly', async () => {
    const first = await pool.query<{ description: string }>(`SELECT description FROM items WHERE slug = 'trinket-001'`);
    const last = await pool.query<{ description: string }>(`SELECT description FROM items WHERE slug = 'trinket-100'`);
    expect(first.rows[0]!.description).toBe('A mummified goblin hand');
    expect(last.rows[0]!.description).toBe('A metal urn containing the ashes of a hero');
  });

  it('names sort correctly (zero-padded, so listItems\' ORDER BY name ASC yields roll order 1-100)', async () => {
    const result = await pool.query<{ name: string }>(
      `SELECT name FROM items WHERE item_type = 'trinket' ORDER BY name ASC`,
    );
    const names = result.rows.map((r) => r.name);
    expect(names[0]).toBe('Trinket #001');
    expect(names[9]).toBe('Trinket #010'); // would be #100/#011/etc. under a naive lexicographic sort bug
    expect(names[names.length - 1]).toBe('Trinket #100');
  });
});

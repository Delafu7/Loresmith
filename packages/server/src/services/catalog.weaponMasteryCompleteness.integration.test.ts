// docs/roadmap/dnd-2024-gap-analysis.md P1-6 (EQ-02) — locks in the seed
// data this phase's mechanical-effects layer depends on: the 8 mastery
// properties, the weapon->mastery mapping (including the shortbow
// slow->vex regression fix), and class_levels.weapon_mastery_count for the
// 5 classes that ever grant Weapon Mastery. Catalog-completeness style,
// read-only against the live seeded DB, no fixtures — matches
// catalog.featCompleteness.integration.test.ts's pattern.

import { afterAll, describe, expect, it } from 'vitest';
import { pool } from '../db/pool.js';

afterAll(async () => {
  await pool.end();
});

describe('weapon mastery catalog completeness (integration, live seeded DB)', () => {
  it('has all 8 SRD mastery properties', async () => {
    const result = await pool.query<{ index_key: string }>(`SELECT index_key FROM weapon_mastery_properties ORDER BY index_key`);
    expect(result.rows.map((r) => r.index_key).sort()).toEqual(
      ['cleave', 'graze', 'nick', 'push', 'sap', 'slow', 'topple', 'vex'].sort(),
    );
  });

  it('shortbow is seeded with Vex, not the stale Slow mapping', async () => {
    const result = await pool.query<{ mastery: string }>(`SELECT properties->>'mastery' AS mastery FROM items WHERE slug = 'shortbow'`);
    expect(result.rows[0]!.mastery).toBe('vex');
  });

  it('every seeded weapon carries a valid mastery index_key', async () => {
    const result = await pool.query<{ slug: string; mastery: string | null }>(
      `SELECT slug, properties->>'mastery' AS mastery FROM items WHERE item_type = 'weapon'`,
    );
    expect(result.rows.length).toBeGreaterThan(0);
    const validKeys = new Set(['cleave', 'graze', 'nick', 'push', 'sap', 'slow', 'topple', 'vex']);
    for (const row of result.rows) {
      expect(row.mastery, `weapon '${row.slug}' has no mastery property`).not.toBeNull();
      expect(validKeys.has(row.mastery!), `weapon '${row.slug}' has invalid mastery '${row.mastery}'`).toBe(true);
    }
  });

  it('Barbarian/Fighter weapon_mastery_count matches the PHB Features table thresholds (2024)', async () => {
    const result = await pool.query<{ level: number; weapon_mastery_count: number }>(
      `SELECT cl.level, cl.weapon_mastery_count FROM class_levels cl
       JOIN classes c ON c.id = cl.class_id
       WHERE c.index_key = 'fighter' AND c.edition_scope = '2024' ORDER BY cl.level`,
    );
    const byLevel = new Map(result.rows.map((r) => [r.level, r.weapon_mastery_count]));
    expect(byLevel.get(1)).toBe(3);
    expect(byLevel.get(3)).toBe(3);
    expect(byLevel.get(4)).toBe(4);
    expect(byLevel.get(9)).toBe(4);
    expect(byLevel.get(10)).toBe(5);
    expect(byLevel.get(15)).toBe(5);
    expect(byLevel.get(16)).toBe(6);
    expect(byLevel.get(20)).toBe(6);
  });

  it('Paladin/Ranger/Rogue weapon_mastery_count is a static 2, never increasing with level', async () => {
    for (const classIndex of ['paladin', 'ranger', 'rogue']) {
      const result = await pool.query<{ weapon_mastery_count: number }>(
        `SELECT DISTINCT cl.weapon_mastery_count FROM class_levels cl
         JOIN classes c ON c.id = cl.class_id
         WHERE c.index_key = $1 AND c.edition_scope = '2024'`,
        [classIndex],
      );
      expect(result.rows, `${classIndex} should have exactly one distinct weapon_mastery_count across all 20 levels`).toHaveLength(1);
      expect(result.rows[0]!.weapon_mastery_count).toBe(2);
    }
  });

  it('classes that never get Weapon Mastery have NULL weapon_mastery_count (not a placeholder zero)', async () => {
    const result = await pool.query<{ weapon_mastery_count: number | null }>(
      `SELECT weapon_mastery_count FROM class_levels cl
       JOIN classes c ON c.id = cl.class_id
       WHERE c.index_key = 'wizard' AND c.edition_scope = '2024' AND cl.level = 1`,
    );
    expect(result.rows[0]!.weapon_mastery_count).toBeNull();
  });

  it('2014 classes have no weapon_mastery_count at all (2024-only mechanic)', async () => {
    const result = await pool.query<{ total: string }>(
      `SELECT COUNT(*)::int AS total FROM class_levels cl
       JOIN classes c ON c.id = cl.class_id
       WHERE c.edition_scope = '2014' AND cl.weapon_mastery_count IS NOT NULL`,
    );
    expect(Number(result.rows[0]!.total)).toBe(0);
  });

  it('the 3 stateful mastery effect templates (Sap/Vex/Slowed) are seeded', async () => {
    const result = await pool.query<{ name: string }>(
      `SELECT name FROM effect_definitions WHERE name IN ('Sap (Weapon Mastery)', 'Vex (Weapon Mastery)', 'Slowed (Weapon Mastery)')`,
    );
    expect(result.rows.map((r) => r.name).sort()).toEqual(['Sap (Weapon Mastery)', 'Slowed (Weapon Mastery)', 'Vex (Weapon Mastery)']);
  });
});

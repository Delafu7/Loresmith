// docs/roadmap/dnd-2024-gap-analysis.md P1-5 (CS-01) — locks in the
// subclass catalog completeness fix in db/seeds/catalog.ts: 4 subclasses
// each for the 6 classes this project can verify against its own PHB docs
// (Barbarian/Bard/Cleric/Druid/Fighter/Monk), with the other 6 classes
// (Paladin/Ranger/Rogue/Sorcerer/Warlock/Wizard) deliberately left at 1
// each — completing them has zero citable source anywhere in this repo,
// per Open Question 1, and the user chose not to complete them with
// unverified content. Read-only against the live seeded DB, no fixtures
// needed.

import { describe, expect, it } from 'vitest';
import { pool } from '../db/pool.js';

const VERIFIED_CLASSES = ['barbarian', 'bard', 'cleric', 'druid', 'fighter', 'monk'];
const UNVERIFIED_CLASSES = ['paladin', 'ranger', 'rogue', 'sorcerer', 'warlock', 'wizard'];

async function subclassCountsByClass(): Promise<Record<string, number>> {
  const res = await pool.query<{ index_key: string; count: string }>(
    `SELECT c.index_key, count(s.id)::text AS count
     FROM classes c LEFT JOIN subclasses s ON s.class_id = c.id
     WHERE c.edition_scope = '2024'
     GROUP BY c.index_key`,
  );
  return Object.fromEntries(res.rows.map((r) => [r.index_key, Number(r.count)]));
}

describe('2024 subclass catalog completeness (integration, live seeded DB)', () => {
  it('the 6 PHB-verified classes each have exactly 4 subclasses', async () => {
    const counts = await subclassCountsByClass();
    for (const classIndex of VERIFIED_CLASSES) {
      expect(counts[classIndex], `class '${classIndex}'`).toBe(4);
    }
  });

  it('the 6 classes with no source text in this project are left at exactly 1 subclass, not force-completed', async () => {
    const counts = await subclassCountsByClass();
    for (const classIndex of UNVERIFIED_CLASSES) {
      expect(counts[classIndex], `class '${classIndex}'`).toBe(1);
    }
  });

  it('every supplemental subclass has at least one class_features row (nothing wired but empty)', async () => {
    const res = await pool.query<{ class_key: string; subclass_key: string; features: string }>(
      `SELECT c.index_key AS class_key, s.index_key AS subclass_key, count(cf.id)::text AS features
       FROM subclasses s
       JOIN classes c ON c.id = s.class_id
       LEFT JOIN class_features cf ON cf.subclass_id = s.id
       WHERE c.edition_scope = '2024' AND c.index_key = ANY($1)
       GROUP BY c.index_key, s.index_key`,
      [VERIFIED_CLASSES],
    );
    expect(res.rows.length).toBe(24); // 6 classes x 4 subclasses
    for (const row of res.rows) {
      expect(Number(row.features), `${row.class_key}/${row.subclass_key}`).toBeGreaterThan(0);
    }
  });

  it("Battle Master's pre-existing maneuver list survives as its own feature alongside the new tiered features", async () => {
    const res = await pool.query<{ name: string }>(
      `SELECT cf.name FROM class_features cf
       JOIN subclasses s ON s.id = cf.subclass_id
       JOIN classes c ON c.id = s.class_id
       WHERE c.index_key = 'fighter' AND c.edition_scope = '2024' AND s.index_key = 'battle-master'
       ORDER BY cf.level ASC`,
    );
    const names = res.rows.map((r) => r.name);
    expect(names).toContain('Maneuver Options');
    expect(names).toContain('Know Your Enemy');
    expect(names).toContain('Ultimate Combat Superiority');
  });
});

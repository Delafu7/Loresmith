// Phase 2 selector work: listMagicSchools/listConditions close the last two
// gaps in the "every catalog list has a GET endpoint" set — magic_schools
// and conditions were seeded (as FK targets for spells.school_id and
// effect_definitions.condition_id) but never got a list function, so the
// web UI had no way to turn either id into a name for a dropdown. Read-only
// against the live seeded DB, no fixtures needed.

import { describe, expect, it } from 'vitest';
import { pool } from '../db/pool.js';
import { listMagicSchools, listConditions } from './catalog.js';

describe('listMagicSchools / listConditions (integration, live seeded DB)', () => {
  it('lists every seeded magic school, alphabetically, with no campaign scoping', async () => {
    const schools = await listMagicSchools(pool);
    expect(schools.length).toBeGreaterThan(0);
    expect(schools.every((s) => typeof s.name === 'string' && typeof s.index_key === 'string')).toBe(true);
    const names = schools.map((s) => s.name as string);
    expect(names).toEqual([...names].sort());
  });

  it('lists conditions unfiltered when no edition is given', async () => {
    const conditions = await listConditions(pool, {});
    expect(conditions.length).toBeGreaterThan(0);
    expect(conditions.every((c) => typeof c.name === 'string' && typeof c.description === 'string')).toBe(true);
  });

  it('filters conditions by edition, still including edition-agnostic rows', async () => {
    const all = await listConditions(pool, {});
    const filtered = await listConditions(pool, { edition: '2024' });
    expect(filtered.length).toBeLessThanOrEqual(all.length);
    expect(filtered.every((c) => c.edition_scope === '2024' || c.edition_scope === 'both')).toBe(true);
  });
});

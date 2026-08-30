// docs/roadmap/dnd-2024-gap-analysis.md P1-3 (SB-01/SB-02) — locks in the
// 2024 species catalog completeness fix in db/seeds/catalog.ts: Aasimar
// (entirely absent from the third-party SRD JSON dataset) and Dragonborn's
// 3 previously-missing traits, both hand-authored from this repo's own
// docs/players-handbook-2024/Chapter 4 text. Read-only against the live
// seeded DB, same "no fixtures needed" convention as
// catalog.magicSchoolsConditions.integration.test.ts.

import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { pool } from '../db/pool.js';
import { listRaces } from './catalog.js';

const noopActorUserId = crypto.randomUUID();

describe('2024 species catalog completeness (integration, live seeded DB)', () => {
  it('has all 10 official 2024 species, including Aasimar', async () => {
    const species = await listRaces(pool, { edition: '2024' }, noopActorUserId);
    const indexKeys = species.map((s) => s.index_key as string).sort();
    expect(indexKeys).toEqual(
      ['aasimar', 'dragonborn', 'dwarf', 'elf', 'gnome', 'goliath', 'halfling', 'human', 'orc', 'tiefling'].sort(),
    );
  });

  it('Aasimar has its 5 official traits and a Medium-or-Small size', async () => {
    const species = await listRaces(pool, { edition: '2024' }, noopActorUserId);
    const aasimar = species.find((s) => s.index_key === 'aasimar')!;
    expect(aasimar.speed).toBe(30);
    expect(aasimar.size).toBe('Medium or Small');
    const traitIndexes = (aasimar.traits as Array<{ index: string }>).map((t) => t.index).sort();
    expect(traitIndexes).toEqual(
      ['celestial-resistance', 'celestial-revelation', 'darkvision-60', 'healing-hands', 'light-bearer'].sort(),
    );
  });

  it('Dragonborn has all 5 official traits, not just the 2 the SRD JSON dataset carried', async () => {
    const species = await listRaces(pool, { edition: '2024' }, noopActorUserId);
    const dragonborn = species.find((s) => s.index_key === 'dragonborn')!;
    const traitIndexes = (dragonborn.traits as Array<{ index: string }>).map((t) => t.index).sort();
    expect(traitIndexes).toEqual(
      ['breath-weapon', 'damage-resistance', 'darkvision-60', 'draconic-ancestry', 'draconic-flight'].sort(),
    );
  });

  it('2014 has no Aasimar (not a core 2014 PHB race, and not independently re-verified for this project)', async () => {
    const species2014 = await listRaces(pool, { edition: '2014' }, noopActorUserId);
    expect(species2014.some((s) => s.index_key === 'aasimar')).toBe(false);
  });
});

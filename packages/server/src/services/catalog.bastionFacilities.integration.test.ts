// Phase 4 "Bastion tracking" sub-phase 1 — snapshot test for the seeded
// bastion_facility_catalog (seeds/catalog.ts's seedBastionFacilityCatalog),
// same purpose as xpBudget.test.ts's threshold-table checks: catch a seed
// transcription typo against docs/rules/bastions.md, not exercise app logic.
// Read-only against the live seeded DB, no fixtures needed — same "no
// campaign scoping" convention as catalog.magicSchoolsConditions.integration.test.ts.

import { describe, expect, it } from 'vitest';
import { pool } from '../db/pool.js';
import { listBastionFacilityCatalog } from './catalog.js';

describe('listBastionFacilityCatalog (integration, live seeded DB)', () => {
  it('seeds exactly 7 basic + 29 special facilities, matching the documented acquisition schedule', async () => {
    const rows = await listBastionFacilityCatalog(pool);
    const basic = rows.filter((r) => r.facility_type === 'basic');
    const special = rows.filter((r) => r.facility_type === 'special');
    expect(basic).toHaveLength(7);
    expect(special).toHaveLength(29);

    // Special Facility Acquisition schedule (docs/rules/bastions.md §1,
    // corroborated final): 2 @ lvl5 total held, but the CATALOG offers more
    // choices than that at each level -- level 5 unlocks 9 catalog options,
    // level 9 adds 10 more (19 cumulative), level 13 adds 6 more (25),
    // level 17 adds 4 more (29). Assert the per-level BREAKDOWN, since that's
    // exactly the shape a seed-script typo (wrong minLevel on one row) would
    // silently corrupt.
    const byLevel = (level: number) => special.filter((r) => r.min_level === level).length;
    expect(byLevel(5)).toBe(9);
    expect(byLevel(9)).toBe(10);
    expect(byLevel(13)).toBe(6);
    expect(byLevel(17)).toBe(4);
  });

  it('basic facilities carry no level gate, order type, or BP die', async () => {
    const rows = await listBastionFacilityCatalog(pool);
    const basic = rows.filter((r) => r.facility_type === 'basic');
    expect(basic.map((r) => r.name as string).sort()).toEqual(
      ['Bedroom', 'Courtyard', 'Dining Room', 'Kitchen', 'Parlor', 'Storage', 'Washroom'],
    );
    for (const facility of basic) {
      expect(facility.min_level).toBeNull();
      expect(facility.order_type).toBeNull();
      expect(facility.bp_die).toBeNull();
      expect(facility.default_space).toBeNull();
      expect(facility.prerequisite_text).toBeNull();
    }
  });

  it('spot-checks specific special facilities against the transcribed catalog (level, prerequisite, space, hirelings, order, BP die)', async () => {
    const rows = await listBastionFacilityCatalog(pool);
    const byKey = new Map(rows.map((r) => [r.index_key as string, r]));

    const smithy = byKey.get('bastion_smithy')!;
    expect(smithy.min_level).toBe(5);
    expect(smithy.prerequisite_text).toBe('Fighting Style feature or Unarmored Defense feature');
    expect(smithy.default_space).toBe('roomy');
    expect(smithy.hireling_count).toBe(2);
    expect(smithy.order_type).toBe('craft');
    expect(smithy.bp_die).toBe('1d4');
    // The one fact this doc independently confirmed against the final book.
    expect((smithy.source_note as string).toLowerCase()).toContain('confirmed');

    const barracks = byKey.get('bastion_barracks')!;
    expect(barracks.hireling_count).toBe(0); // 0-hireling facility must still be a real order target, not excluded

    const warRoom = byKey.get('bastion_war_room')!;
    expect(warRoom.min_level).toBe(17);
    expect(warRoom.hireling_count).toBeNull(); // "varies" -- not a fixed count, see benefits JSONB
    expect(warRoom.order_type).toBe('recruit');
    expect(warRoom.bp_die).toBe('1d10');

    const meditationChamber = byKey.get('bastion_meditation_chamber')!;
    expect(meditationChamber.default_space).toBe('cramped');
    expect(meditationChamber.min_level).toBe(13);

    const guildhall = byKey.get('bastion_guildhall')!;
    expect(guildhall.prerequisite_text).toBe('Expertise in a skill');
    expect(guildhall.default_space).toBe('vast');
  });

  it('every special facility has a non-null order type, BP die, and space; every row (basic or special) has a source note', async () => {
    const rows = await listBastionFacilityCatalog(pool);
    for (const facility of rows.filter((r) => r.facility_type === 'special')) {
      expect(facility.order_type).not.toBeNull();
      expect(facility.bp_die).not.toBeNull();
      expect(facility.default_space).not.toBeNull();
      expect(typeof facility.source_note).toBe('string');
      expect((facility.source_note as string).length).toBeGreaterThan(0);
    }
    for (const facility of rows) {
      expect(typeof facility.source_note).toBe('string');
    }
  });
});

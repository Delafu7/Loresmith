import { describe, expect, it } from 'vitest';
import { computeEncumbrance } from './encumbrance.js';

describe('computeEncumbrance', () => {
  it('carrying capacity is STR x 15', () => {
    expect(computeEncumbrance(10, 0).carryCapacityLb).toBe(150);
    expect(computeEncumbrance(18, 0).carryCapacityLb).toBe(270);
  });

  it('encumbered/heavily-encumbered thresholds are STR x 5 and STR x 10', () => {
    const result = computeEncumbrance(10, 0);
    expect(result.encumberedThresholdLb).toBe(50);
    expect(result.heavilyEncumberedThresholdLb).toBe(100);
  });

  it('under the encumbered threshold: neither flag set', () => {
    const result = computeEncumbrance(10, 40);
    expect(result.encumbered).toBe(false);
    expect(result.heavilyEncumbered).toBe(false);
  });

  it('exactly at the encumbered threshold: not yet encumbered (strictly greater-than)', () => {
    const result = computeEncumbrance(10, 50);
    expect(result.encumbered).toBe(false);
  });

  it('just over the encumbered threshold: encumbered but not heavily', () => {
    const result = computeEncumbrance(10, 51);
    expect(result.encumbered).toBe(true);
    expect(result.heavilyEncumbered).toBe(false);
  });

  it('over the heavily-encumbered threshold: both flags set', () => {
    const result = computeEncumbrance(10, 101);
    expect(result.encumbered).toBe(true);
    expect(result.heavilyEncumbered).toBe(true);
  });

  it('over raw carry capacity implies heavily encumbered too', () => {
    const result = computeEncumbrance(10, 151);
    expect(result.totalCarriedLb).toBe(151);
    expect(result.carryCapacityLb).toBe(150);
    expect(result.heavilyEncumbered).toBe(true);
  });
});

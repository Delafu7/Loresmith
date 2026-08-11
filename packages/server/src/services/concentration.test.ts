import { describe, expect, it } from 'vitest';
import { computeConcentrationDc } from './concentration.js';

describe('computeConcentrationDc', () => {
  it('is half the damage, rounded down', () => {
    expect(computeConcentrationDc(20)).toBe(10);
    expect(computeConcentrationDc(21)).toBe(10);
    expect(computeConcentrationDc(22)).toBe(11);
  });

  it('is never below the SRD floor of 10, even for tiny damage', () => {
    expect(computeConcentrationDc(1)).toBe(10);
    expect(computeConcentrationDc(0)).toBe(10);
  });
});

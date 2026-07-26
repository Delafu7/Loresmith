import { describe, expect, it } from 'vitest';
import { footprintCellsFor, normalizeSizeKey, SIZE_FOOTPRINT_CELLS } from './creatureSize';

describe('normalizeSizeKey', () => {
  it('matches the six canonical Title Case categories exactly', () => {
    expect(normalizeSizeKey('Tiny')).toEqual({ key: 'Tiny', recognized: true });
    expect(normalizeSizeKey('Small')).toEqual({ key: 'Small', recognized: true });
    expect(normalizeSizeKey('Medium')).toEqual({ key: 'Medium', recognized: true });
    expect(normalizeSizeKey('Large')).toEqual({ key: 'Large', recognized: true });
    expect(normalizeSizeKey('Huge')).toEqual({ key: 'Huge', recognized: true });
    expect(normalizeSizeKey('Gargantuan')).toEqual({ key: 'Gargantuan', recognized: true });
  });

  it('is case- and whitespace-insensitive', () => {
    expect(normalizeSizeKey('small')).toEqual({ key: 'Small', recognized: true });
    expect(normalizeSizeKey('SMALL')).toEqual({ key: 'Small', recognized: true });
    expect(normalizeSizeKey(' Large ')).toEqual({ key: 'Large', recognized: true });
  });

  it('falls back to Medium (recognized: false) for unrecognized, empty, or missing input', () => {
    expect(normalizeSizeKey('Large (Swarm)')).toEqual({ key: 'Medium', recognized: false });
    expect(normalizeSizeKey('')).toEqual({ key: 'Medium', recognized: false });
    expect(normalizeSizeKey(undefined)).toEqual({ key: 'Medium', recognized: false });
    expect(normalizeSizeKey(null)).toEqual({ key: 'Medium', recognized: false });
  });
});

describe('footprintCellsFor', () => {
  it('returns the exact NxN span per docs/rules/creature-sizes.md', () => {
    expect(footprintCellsFor('Tiny')).toBe(1);
    expect(footprintCellsFor('Small')).toBe(1);
    expect(footprintCellsFor('Medium')).toBe(1);
    expect(footprintCellsFor('Large')).toBe(2);
    expect(footprintCellsFor('Huge')).toBe(3);
    expect(footprintCellsFor('Gargantuan')).toBe(4);
  });

  it('unrecognized input never renders a 0-cell or undefined footprint', () => {
    expect(footprintCellsFor('nonsense')).toBe(SIZE_FOOTPRINT_CELLS.Medium);
  });
});

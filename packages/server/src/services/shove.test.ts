import { describe, expect, it } from 'vitest';
import { canShoveSize } from './shove.js';

describe('canShoveSize', () => {
  it('allows shoving a same-size (Medium) target', () => {
    expect(canShoveSize('Medium')).toBe(true);
  });

  it('allows shoving a target exactly one size category larger', () => {
    expect(canShoveSize('Large')).toBe(true);
  });

  it('allows shoving smaller targets', () => {
    expect(canShoveSize('Tiny')).toBe(true);
    expect(canShoveSize('Small')).toBe(true);
  });

  it('rejects a target two or more size categories larger', () => {
    expect(canShoveSize('Huge')).toBe(false);
    expect(canShoveSize('Gargantuan')).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(canShoveSize('large')).toBe(true);
    expect(canShoveSize('HUGE')).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { formatDistance } from './units';

// Minimal stand-in for useLocale()'s t() — only the two keys formatDistance
// actually calls exist here, matching this file's isolation from the real
// dictionaries (same spirit as dnd-math.test.ts's pure-function tests).
const t = (key: string) => (key === 'common.feetUnit' ? 'ft.' : key === 'common.metersUnit' ? 'm' : key);

describe('formatDistance', () => {
  it('imperial passes the feet value straight through', () => {
    expect(formatDistance(30, 'imperial', t)).toBe('30 ft.');
    expect(formatDistance(5, 'imperial', t)).toBe('5 ft.');
  });

  it('metric converts using the project\'s 1 ft = 0.3 m convention', () => {
    // CLAUDE.md / the dnd5e-srd skill's own reference-text convention.
    expect(formatDistance(5, 'metric', t)).toBe('1.5 m');
    expect(formatDistance(30, 'metric', t)).toBe('9 m');
    expect(formatDistance(60, 'metric', t)).toBe('18 m');
  });

  it('metric rounds to the nearest half-meter', () => {
    expect(formatDistance(10, 'metric', t)).toBe('3 m');
    expect(formatDistance(35, 'metric', t)).toBe('10.5 m');
    expect(formatDistance(1, 'metric', t)).toBe('0.5 m');
  });

  it('zero feet formats as zero in both systems', () => {
    expect(formatDistance(0, 'imperial', t)).toBe('0 ft.');
    expect(formatDistance(0, 'metric', t)).toBe('0 m');
  });
});

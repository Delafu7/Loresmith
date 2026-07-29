// Unit tests for the i18n dictionaries themselves — es.ts/fr.ts already get
// compile-time key-parity checking (`satisfies typeof en`), so what's worth
// testing at runtime is: no dictionary has an empty/missing translation,
// and the {placeholder} interpolation used by dashboard.welcome etc. round-
// trips correctly. LocaleProvider/useLocale need a React tree + AuthContext
// to render, so those are exercised indirectly via the pages that use them
// rather than in isolation here.

import { describe, expect, it } from 'vitest';
import { en } from './dictionaries/en/index.js';
import { es } from './dictionaries/es/index.js';
import { fr } from './dictionaries/fr/index.js';

// A dictionary section can nest arbitrarily deep (see DotPaths<T> in
// LocaleContext.tsx, which recursively supports any depth) — e.g.
// characters.abilityGenerator.methods.manual. flatten() walks the whole
// tree down to string leaves rather than assuming a fixed two-level shape.
type Dict = { [key: string]: string | Dict };

function flatten(dict: Dict, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(dict)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') {
      out[path] = value;
    } else {
      Object.assign(out, flatten(value, path));
    }
  }
  return out;
}

describe('i18n dictionaries', () => {
  it.each([
    ['en', en],
    ['es', es],
    ['fr', fr],
  ])('%s has no empty translations', (_name, dict) => {
    for (const value of Object.values(flatten(dict as Dict))) {
      expect(value.length).toBeGreaterThan(0);
    }
  });

  it('es and fr have exactly the same keys as en', () => {
    const enKeys = Object.keys(flatten(en)).sort();
    expect(Object.keys(flatten(es)).sort()).toEqual(enKeys);
    expect(Object.keys(flatten(fr)).sort()).toEqual(enKeys);
  });

  it('every {placeholder} used in en also appears in the same key in es/fr', () => {
    const placeholderPattern = /\{(\w+)\}/g;
    for (const [key, template] of Object.entries(flatten(en))) {
      const expected = [...template.matchAll(placeholderPattern)].map((m) => m[1]).sort();
      if (expected.length === 0) continue;
      for (const [name, dict] of [
        ['es', es],
        ['fr', fr],
      ] as const) {
        const other = flatten(dict as Dict)[key]!;
        const actual = [...other.matchAll(placeholderPattern)].map((m) => m[1]).sort();
        expect(actual, `${name}.${key} placeholders`).toEqual(expected);
      }
    }
  });
});

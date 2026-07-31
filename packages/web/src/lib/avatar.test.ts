// Unit tests for the home-screen redesign's two pure helpers — everything
// else in DashboardPage.tsx is JSX layout with no independent branching
// worth a render test (query loading/error/empty states all reuse
// components already covered elsewhere).

import { describe, expect, it } from 'vitest';
import { avatarColor, initials, AVATAR_COLORS } from './DashboardPage';

describe('avatarColor', () => {
  it('always returns one of the fixed theme-slot classes', () => {
    for (const id of ['a', 'character-1', '11111111-1111-1111-1111-111111111111', '']) {
      expect(AVATAR_COLORS).toContain(avatarColor(id));
    }
  });

  it('is deterministic for the same id', () => {
    const id = 'abc-123';
    expect(avatarColor(id)).toBe(avatarColor(id));
  });

  it('varies across different ids (not a constant)', () => {
    const colors = new Set(['aaa', 'bbb', 'ccc', 'ddd', 'eee', 'fff'].map(avatarColor));
    expect(colors.size).toBeGreaterThan(1);
  });
});

describe('initials', () => {
  it('takes the first letter of the first and last word for a multi-word name', () => {
    expect(initials('Brenna Ironhide')).toBe('BI');
  });

  it('uses just the first letter for a single-word name', () => {
    expect(initials('Ostiv')).toBe('O');
  });

  it('ignores extra whitespace', () => {
    expect(initials('  Sister   Maribel  ')).toBe('SM');
  });

  it('uppercases the result', () => {
    expect(initials('kessia duskbane')).toBe('KD');
  });
});

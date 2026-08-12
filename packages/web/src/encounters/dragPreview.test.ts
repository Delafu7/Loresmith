import { describe, expect, it } from 'vitest';
import { estimateDragDistanceFt } from './dragPreview';

describe('estimateDragDistanceFt', () => {
  it('a straight orthogonal move costs exactly distance * feetPerCell (mirrors movement.test.ts)', () => {
    expect(estimateDragDistanceFt({ x: 0, y: 0 }, { x: 3, y: 0 }, 5, 'flat')).toBe(15);
  });

  it('a diagonal move under the flat rule costs the same per-cell as orthogonal', () => {
    expect(estimateDragDistanceFt({ x: 0, y: 0 }, { x: 3, y: 3 }, 5, 'flat')).toBe(15);
  });

  it('staying in place costs 0', () => {
    expect(estimateDragDistanceFt({ x: 2, y: 2 }, { x: 2, y: 2 }, 5, 'flat')).toBe(0);
  });

  it('alternates base cost per diagonal step: 5, 10, 5, 10... (mirrors movement.test.ts)', () => {
    // 4 diagonal steps: 5 + 10 + 5 + 10 = 30
    expect(estimateDragDistanceFt({ x: 0, y: 0 }, { x: 4, y: 4 }, 5, 'alternating_5_10_5')).toBe(30);
  });

  it('orthogonal steps never trigger the alternating charge', () => {
    expect(estimateDragDistanceFt({ x: 0, y: 0 }, { x: 4, y: 0 }, 5, 'alternating_5_10_5')).toBe(20);
  });

  it('a mixed move combines straight steps at base cost with alternating diagonal steps', () => {
    // dx=5, dy=2 -> 2 diagonal steps (5+10=15) + 3 straight steps (15) = 30
    expect(estimateDragDistanceFt({ x: 0, y: 0 }, { x: 5, y: 2 }, 5, 'alternating_5_10_5')).toBe(30);
  });

  it('is symmetric regardless of direction', () => {
    expect(estimateDragDistanceFt({ x: 4, y: 4 }, { x: 0, y: 0 }, 5, 'alternating_5_10_5')).toBe(30);
  });
});

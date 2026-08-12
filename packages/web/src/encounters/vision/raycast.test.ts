import { describe, expect, it } from 'vitest';
import { computeVisibilityPolygon, type Segment } from './raycast';

const ORIGIN = { x: 0, y: 0 };

function distances(points: { x: number; y: number }[]): number[] {
  return points.map((p) => Math.hypot(p.x - ORIGIN.x, p.y - ORIGIN.y));
}

describe('computeVisibilityPolygon', () => {
  it('an empty room (no walls) resolves to a full circle of radius maxRadius', () => {
    const polygon = computeVisibilityPolygon(ORIGIN, [], 100);
    expect(polygon.length).toBeGreaterThan(30);
    for (const d of distances(polygon)) {
      expect(d).toBeCloseTo(100, 5);
    }
  });

  it('radius clamps — no polygon vertex ever exceeds maxRadius, with or without walls', () => {
    const wall: Segment = { x1: -20, y1: -50, x2: -20, y2: 50 };
    const polygon = computeVisibilityPolygon(ORIGIN, [wall], 100);
    for (const d of distances(polygon)) {
      expect(d).toBeLessThanOrEqual(100 + 1e-6);
    }
  });

  it('a single wall casts a shadow — some rays are shortened below maxRadius', () => {
    // A wall directly to the "east" of the origin, well within maxRadius.
    const wall: Segment = { x1: 20, y1: -10, x2: 20, y2: 10 };
    const polygon = computeVisibilityPolygon(ORIGIN, [wall], 100);
    const ds = distances(polygon);
    expect(Math.min(...ds)).toBeLessThan(30); // rays hitting the wall stop near it
    expect(Math.max(...ds)).toBeCloseTo(100, 5); // rays elsewhere still reach the full radius
  });

  it('a wall segment that fully encircles the origin blocks everything beyond it', () => {
    // A small square "room" wall around the origin, radius 10 out of a much larger maxRadius.
    const walls: Segment[] = [
      { x1: -10, y1: -10, x2: 10, y2: -10 },
      { x1: 10, y1: -10, x2: 10, y2: 10 },
      { x1: 10, y1: 10, x2: -10, y2: 10 },
      { x1: -10, y1: 10, x2: -10, y2: -10 },
    ];
    const polygon = computeVisibilityPolygon(ORIGIN, walls, 100);
    for (const d of distances(polygon)) {
      // Every ray is stopped by the enclosing square well short of maxRadius.
      expect(d).toBeLessThan(20);
    }
  });

  it('returns no points for a non-positive radius', () => {
    expect(computeVisibilityPolygon(ORIGIN, [], 0)).toEqual([]);
    expect(computeVisibilityPolygon(ORIGIN, [], -5)).toEqual([]);
  });
});

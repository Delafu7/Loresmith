import { describe, expect, it } from 'vitest';
import { classifyVisibility } from './levelAt';
import type { FogPolygon } from './fogUnion';

const SQUARE = [{ x: -10, y: -10 }, { x: 10, y: -10 }, { x: 10, y: 10 }, { x: -10, y: 10 }];

describe('classifyVisibility', () => {
  it('a point inside a bright polygon is bright', () => {
    const polygons: FogPolygon[] = [{ id: '1', sourceId: 'a', band: 'bright', points: SQUARE }];
    expect(classifyVisibility({ x: 0, y: 0 }, polygons)).toBe('bright');
  });

  it('a point inside only a darkvision polygon is darkvision', () => {
    const polygons: FogPolygon[] = [{ id: '1', sourceId: 'a', band: 'darkvision', points: SQUARE }];
    expect(classifyVisibility({ x: 0, y: 0 }, polygons)).toBe('darkvision');
  });

  it('a point outside every polygon is darkness', () => {
    const polygons: FogPolygon[] = [{ id: '1', sourceId: 'a', band: 'bright', points: SQUARE }];
    expect(classifyVisibility({ x: 100, y: 100 }, polygons)).toBe('darkness');
  });

  it('bright wins when a point falls inside both a bright and a darkvision polygon', () => {
    const polygons: FogPolygon[] = [
      { id: '1', sourceId: 'a', band: 'darkvision', points: SQUARE },
      { id: '2', sourceId: 'b', band: 'bright', points: SQUARE },
    ];
    expect(classifyVisibility({ x: 0, y: 0 }, polygons)).toBe('bright');
  });

  it('degenerate (fewer than 3 point) polygons are ignored rather than crashing', () => {
    const polygons: FogPolygon[] = [{ id: '1', sourceId: 'a', band: 'bright', points: [{ x: 0, y: 0 }] }];
    expect(classifyVisibility({ x: 0, y: 0 }, polygons)).toBe('darkness');
  });
});

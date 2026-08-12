import { describe, expect, it } from 'vitest';
import { buildFogPolygons } from './fogUnion';

const ORIGIN = { x: 0, y: 0 };

describe('buildFogPolygons', () => {
  it('a disabled viewer contributes nothing', () => {
    const polygons = buildFogPolygons([{ id: 'a', origin: ORIGIN, visionRadiusPx: 100, darkvisionRadiusPx: 0, enabled: false }], []);
    expect(polygons).toEqual([]);
  });

  it('a viewer with darkvisionRadiusPx <= visionRadiusPx only contributes a bright polygon', () => {
    const polygons = buildFogPolygons([{ id: 'a', origin: ORIGIN, visionRadiusPx: 100, darkvisionRadiusPx: 0, enabled: true }], []);
    expect(polygons.length).toBe(1);
    expect(polygons[0]!.band).toBe('bright');
  });

  it('a viewer with darkvision beyond its vision radius contributes both bands', () => {
    const polygons = buildFogPolygons([{ id: 'a', origin: ORIGIN, visionRadiusPx: 60, darkvisionRadiusPx: 120, enabled: true }], []);
    expect(polygons.map((p) => p.band).sort()).toEqual(['bright', 'darkvision']);
  });

  it('each viewer contributes independently, ids stay distinct', () => {
    const polygons = buildFogPolygons(
      [
        { id: 'a', origin: ORIGIN, visionRadiusPx: 60, darkvisionRadiusPx: 0, enabled: true },
        { id: 'b', origin: { x: 50, y: 0 }, visionRadiusPx: 60, darkvisionRadiusPx: 0, enabled: true },
      ],
      [],
    );
    expect(polygons.length).toBe(2);
    expect(new Set(polygons.map((p) => p.id)).size).toBe(2);
  });
});

// Classifies a single point against an already-assembled set of fog
// polygons (fogUnion.ts) — banding WITHIN the fog, not shaping it (the
// polygons themselves are what raycast.ts computed). Used for point-level
// queries (e.g. "is this specific cell currently lit for anyone") rather
// than the actual pixel rendering, which composites the polygons directly
// via an SVG mask in VisionOverlay.tsx and never calls this per-pixel.
import type { Point } from './raycast';
import type { FogPolygon } from './fogUnion';

export type VisibilityBand = 'bright' | 'darkvision' | 'darkness';

// Standard even-odd ray-casting point-in-polygon test.
function pointInPolygon(point: Point, polygon: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const pi = polygon[i]!;
    const pj = polygon[j]!;
    const intersects = pi.y > point.y !== pj.y > point.y && point.x < ((pj.x - pi.x) * (point.y - pi.y)) / (pj.y - pi.y) + pi.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

/** 'bright' wins over 'darkvision' if a point falls in both (e.g. two overlapping viewers, one seeing it in normal range, another only via darkvision). */
export function classifyVisibility(point: Point, polygons: FogPolygon[]): VisibilityBand {
  let sawDarkvision = false;
  for (const poly of polygons) {
    if (poly.points.length < 3) continue;
    if (!pointInPolygon(point, poly.points)) continue;
    if (poly.band === 'bright') return 'bright';
    sawDarkvision = true;
  }
  return sawDarkvision ? 'darkvision' : 'darkness';
}

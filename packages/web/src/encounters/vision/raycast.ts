// Pure 2D shadow-casting visibility polygon — the correctness-critical core
// of fog-of-war. Works in whatever flat coordinate space the caller passes
// in (fogUnion.ts feeds it pixel space); this file has no opinion on units.
//
// Algorithm: cast a ray from `origin` at every "interesting" angle — each
// wall segment's two endpoints, nudged by a tiny +/-epsilon so the ray
// passes just past a corner rather than grazing it exactly (the standard
// fix for the "ray exactly clips a vertex" degenerate case) — plus a fixed
// set of evenly-spaced fallback angles so an area with NO walls still
// resolves to a smooth circle instead of a sparse, jagged polygon with only
// as many vertices as nearby wall corners happen to produce. For each
// angle, find the nearest segment intersection (or `maxRadius` if none);
// sort the resulting hit points by angle to close the polygon.

export interface Point {
  x: number;
  y: number;
}

export interface Segment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

const ANGLE_EPSILON = 0.00001;
const FALLBACK_RAY_COUNT = 64;

/** Distance along the ray (t >= 0) to its intersection with `seg`, or null if none (parallel, or intersection falls outside the segment's own [0,1] span). */
function raySegmentIntersection(ox: number, oy: number, dx: number, dy: number, seg: Segment): number | null {
  const v1x = ox - seg.x1;
  const v1y = oy - seg.y1;
  const v2x = seg.x2 - seg.x1;
  const v2y = seg.y2 - seg.y1;
  const v3x = -dy;
  const v3y = dx;

  const denom = v2x * v3x + v2y * v3y;
  if (Math.abs(denom) < 1e-10) return null; // parallel to the ray

  const t = (v2x * v1y - v2y * v1x) / denom;
  const s = (v1x * v3x + v1y * v3y) / denom;
  if (t >= 0 && s >= 0 && s <= 1) return t;
  return null;
}

function castRay(origin: Point, angle: number, segments: Segment[], maxRadius: number): Point {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  let nearest = maxRadius;
  for (const seg of segments) {
    const t = raySegmentIntersection(origin.x, origin.y, dx, dy, seg);
    if (t != null && t < nearest) nearest = t;
  }
  return { x: origin.x + dx * nearest, y: origin.y + dy * nearest };
}

function angleTo(origin: Point, point: Point): number {
  return Math.atan2(point.y - origin.y, point.x - origin.x);
}

/** A closed polygon (ordered by angle) approximating everything visible from `origin` within `maxRadius`, with `segments` casting opaque shadows. Returns a full-circle approximation when `segments` is empty or none are in range. */
export function computeVisibilityPolygon(origin: Point, segments: Segment[], maxRadius: number): Point[] {
  if (maxRadius <= 0) return [];

  const angles = new Set<number>();
  for (let i = 0; i < FALLBACK_RAY_COUNT; i++) {
    angles.add((i / FALLBACK_RAY_COUNT) * Math.PI * 2);
  }
  for (const seg of segments) {
    for (const p of [{ x: seg.x1, y: seg.y1 }, { x: seg.x2, y: seg.y2 }]) {
      const a = angleTo(origin, p);
      angles.add(a - ANGLE_EPSILON);
      angles.add(a);
      angles.add(a + ANGLE_EPSILON);
    }
  }

  const points = [...angles]
    .map((angle) => ({ angle, point: castRay(origin, angle, segments, maxRadius) }))
    .sort((a, b) => a.angle - b.angle)
    .map((a) => a.point);

  return points;
}

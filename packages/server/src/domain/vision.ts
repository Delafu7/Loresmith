// Server-side line-of-sight + per-viewer visibility for darkness (nav point
// 4 follow-up). Everything under packages/web/src/encounters/vision/ is a
// pure rendering concern (an SVG fog mask painted over data the client
// already received in full); this module is the actual security boundary —
// sockets/broadcast.ts's buildFullStateSyncPayload calls it to decide which
// participant ROWS a given player even gets sent, under 'dark' map lighting.
//
// Deliberately NOT a port of the client's shadow-casting visibility polygon
// (packages/web/src/encounters/vision/raycast.ts) — that machinery exists to
// RENDER a smooth fog shape and has no reason to run per-connection on the
// server. All the server needs is a yes/no per (viewer, target) pair, so
// this does the simple thing the task brief asks for: a straight-line
// range check plus one segment-intersection test per wall. Equivalent to
// "is target inside the visibility polygon" for a radius-bounded polygon,
// just without ever constructing the polygon.

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

const EPSILON = 1e-9;

/** Strict interior segment/segment intersection (shared endpoints don't count as blocking — a token standing in a doorway shouldn't blind itself). */
export function segmentsIntersect(a1: Point, a2: Point, b: Segment): boolean {
  const d1x = a2.x - a1.x;
  const d1y = a2.y - a1.y;
  const d2x = b.x2 - b.x1;
  const d2y = b.y2 - b.y1;

  const denom = d1x * d2y - d1y * d2x;
  if (Math.abs(denom) < EPSILON) return false; // parallel/collinear — never treated as blocking

  const t = ((b.x1 - a1.x) * d2y - (b.y1 - a1.y) * d2x) / denom;
  const s = ((b.x1 - a1.x) * d1y - (b.y1 - a1.y) * d1x) / denom;
  return t > EPSILON && t < 1 - EPSILON && s > EPSILON && s < 1 - EPSILON;
}

export function hasLineOfSight(origin: Point, target: Point, walls: Segment[]): boolean {
  return walls.every((w) => !segmentsIntersect(origin, target, w));
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** Minimal element shape this module needs — matches both a full wire map element and mapElements.ts's RedactedMapElement stub, so it works on the SAME already-per-viewer-filtered array buildFullStateSyncPayload built for rendering, no separate raw query. */
export interface VisionBlockingElement {
  x1: number;
  y1: number;
  x2: number | null;
  y2: number | null;
  blocksVision: boolean;
}

export function wallSegmentsFromElements(elements: VisionBlockingElement[]): Segment[] {
  const segments: Segment[] = [];
  for (const el of elements) {
    if (el.x2 == null || el.y2 == null) continue; // point/polygon types never block vision
    if (!el.blocksVision) continue;
    segments.push({ x1: el.x1, y1: el.y1, x2: el.x2, y2: el.y2 });
  }
  return segments;
}

export interface VisionParticipant {
  participantId: string;
  ownerUserId: string | null;
  faction: 'player' | 'ally' | 'enemy' | 'neutral';
  posX: number | null;
  posY: number | null;
  visionEnabled: boolean;
  visionRadiusFt: number;
  darkvisionRadiusFt: number;
}

/**
 * The participant ids `viewerUserId` may see under 'dark' lighting:
 * - every faction==='player' participant, unconditionally (own party is
 *   always visible per the task brief, regardless of range/LOS/lighting) —
 *   plus the viewer's own participant(s), as a safety net if a PC's faction
 *   was ever hand-edited away from 'player'.
 * - every OTHER participant within range of, and in line of sight from, at
 *   least one of the viewer's own vision-enabled seated characters. Range is
 *   max(visionRadiusFt, darkvisionRadiusFt) — darkvision only ever extends
 *   how far a creature sees in the dark, never shrinks it — converted to
 *   grid-cell units via feetPerCell (positions and wall geometry are both in
 *   cell space already, matching the client's cellToPx-based rendering).
 *
 * A viewer with no seated, vision-enabled character of their own (e.g. a
 * spectator, or their PC hasn't been placed on the map yet) sees only the
 * always-visible party set.
 */
export function computeVisibleParticipantIds(
  viewerUserId: string,
  participants: VisionParticipant[],
  wallSegments: Segment[],
  feetPerCell: number,
): Set<string> {
  const visible = new Set<string>();
  for (const p of participants) {
    if (p.faction === 'player' || p.ownerUserId === viewerUserId) visible.add(p.participantId);
  }

  if (feetPerCell <= 0) return visible; // no usable map scale to compute range against

  const viewers = participants.filter(
    (p) => p.ownerUserId === viewerUserId && p.visionEnabled && p.posX != null && p.posY != null,
  );
  if (viewers.length === 0) return visible;

  for (const target of participants) {
    if (visible.has(target.participantId)) continue;
    if (target.posX == null || target.posY == null) continue; // not placed on the map yet

    const dest: Point = { x: target.posX, y: target.posY };
    const inSight = viewers.some((viewer) => {
      const rangeCells = Math.max(viewer.visionRadiusFt, viewer.darkvisionRadiusFt) / feetPerCell;
      if (rangeCells <= 0) return false;
      const origin: Point = { x: viewer.posX!, y: viewer.posY! };
      return distance(origin, dest) <= rangeCells && hasLineOfSight(origin, dest, wallSegments);
    });
    if (inSight) visible.add(target.participantId);
  }

  return visible;
}

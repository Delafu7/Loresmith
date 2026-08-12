// Wall/closed-door MapElements -> opaque Segment[] for raycast.ts. Uses
// elementBlocksVision (registry.tsx) rather than checking `el.type ===
// 'wall'` directly for the door case, so a future vision-blocking type never
// needs an edit here — it only needs to return true from its own
// blocksVision() and have x1/y1/x2/y2 geometry.
import type { MapElement } from '../../lib/types';
import { elementBlocksVision } from '../elements/registry';
import { segmentToPx } from '../geometry';
import type { Segment } from './raycast';

export function wallSegmentsFromElements(elements: MapElement[], cellSizePx: number): Segment[] {
  const segments: Segment[] = [];
  for (const el of elements) {
    if (el.x2 == null || el.y2 == null) continue; // point/polygon types never block vision via this path
    if (!elementBlocksVision(el)) continue;
    segments.push(segmentToPx(el.x1, el.y1, el.x2, el.y2, cellSizePx));
  }
  return segments;
}

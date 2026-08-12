// Assembles per-source visibility polygons for the SVG mask (VisionOverlay.tsx)
// — the actual UNION of overlapping polygons is "free," left entirely to the
// browser's SVG mask compositing (overlapping white polygons on a mask just
// overlap; no polygon-boolean-union library needed, per the plan's decision
// to use an SVG overlay specifically for this reason).
//
// Each viewer contributes up to two independently wall-shadowed polygons —
// one for its normal (visionRadiusFt) range and one for the darkvision
// extension beyond it — rather than a single polygon post-hoc split into
// bands, since raycasting each radius separately is both simpler and more
// correct (a wall's shadow at the shorter radius isn't necessarily the same
// shape as at the longer one).
//
// Scope note: DM-placed `light` elements render their own decorative glow
// (elements/registry.tsx) but do not themselves reveal fog in this pass —
// only token vision does. Merging authored light radius into the fog union
// is a natural follow-up, not attempted here.
import { computeVisibilityPolygon, type Point, type Segment } from './raycast';

export type FogBand = 'bright' | 'darkvision';

export interface FogPolygon {
  id: string;
  sourceId: string;
  band: FogBand;
  points: Point[];
}

export interface FogViewer {
  id: string;
  origin: Point;
  visionRadiusPx: number;
  darkvisionRadiusPx: number;
  enabled: boolean;
}

export function buildFogPolygons(viewers: FogViewer[], wallSegments: Segment[]): FogPolygon[] {
  const polygons: FogPolygon[] = [];
  for (const viewer of viewers) {
    if (!viewer.enabled) continue;
    if (viewer.visionRadiusPx > 0) {
      polygons.push({
        id: `${viewer.id}-bright`,
        sourceId: viewer.id,
        band: 'bright',
        points: computeVisibilityPolygon(viewer.origin, wallSegments, viewer.visionRadiusPx),
      });
    }
    if (viewer.darkvisionRadiusPx > viewer.visionRadiusPx) {
      polygons.push({
        id: `${viewer.id}-darkvision`,
        sourceId: viewer.id,
        band: 'darkvision',
        points: computeVisibilityPolygon(viewer.origin, wallSegments, viewer.darkvisionRadiusPx),
      });
    }
  }
  return polygons;
}

// Single home for every grid<->pixel<->feet conversion on the battle map —
// used by drag-preview (dragPreview.ts), map-element placement
// (elements/geometry.ts's segmentStyle builds on cellToPx), and vision
// raycasting (vision/*.ts) alike, so none of them re-derive the same math
// independently. Grid-cell units are the map's canonical coordinate space
// (see lib/types.ts's MapElement doc comment); pixels are a render-time
// concern (cellSizePx), feet are a movement-math concern (feetPerCell).

export function cellToPx(cell: number, cellSizePx: number): number {
  return cell * cellSizePx;
}

export function pxToCell(px: number, cellSizePx: number): number {
  return px / cellSizePx;
}

export function cellsToFeet(cells: number, feetPerCell: number): number {
  return cells * feetPerCell;
}

export function feetToCells(feet: number, feetPerCell: number): number {
  return feet / feetPerCell;
}

export interface PxSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export function segmentToPx(x1: number, y1: number, x2: number, y2: number, cellSizePx: number): PxSegment {
  return { x1: cellToPx(x1, cellSizePx), y1: cellToPx(y1, cellSizePx), x2: cellToPx(x2, cellSizePx), y2: cellToPx(y2, cellSizePx) };
}

/** Snaps a pixel offset to the nearest grid LINE (cell edge), not a cell center — used for wall/door placement, distinct from a token's snap-to-cell-center. */
export function snapToGridEdge(px: number, cellSizePx: number): number {
  return Math.round(px / cellSizePx) * cellSizePx;
}

/** Snaps a pixel offset to the nearest cell INDEX — the token drag-drop convention (Token.tsx mirrors this inline; exported here so other callers don't duplicate it). */
export function snapToCell(px: number, cellSizePx: number): number {
  return Math.round(pxToCell(px, cellSizePx));
}

// --- Viewport (screen <-> world) conversions -------------------------------
// "World" here is the same unscaled map-pixel space cellToPx/pxToCell already
// operate in (mapWidthPx/mapHeightPx at zoom=1) — the space every child of
// BattleMap's transformed content div is authored in. "Screen" is raw
// viewport-relative pixels (clientX/clientY minus the container's own
// bounding-rect origin). The content div's CSS transform is
// `translate(panX,panY) scale(zoom)`: per CSS's transform-composition order,
// scale applies first (in local/world space) and translate second (in the
// parent's/screen's unscaled space) — so panX/panY are always plain screen
// pixels regardless of zoom, and a screen-pixel pan delta can be applied to
// them directly with no zoom division. Converting a single point needs both;
// converting a DELTA between two screen points only needs zoom (pan cancels
// out of a subtraction) — see screenDeltaToWorld below.

export interface Viewport {
  panX: number;
  panY: number;
  zoom: number;
}

export function screenToWorld(screenX: number, screenY: number, viewport: Viewport): { x: number; y: number } {
  return { x: (screenX - viewport.panX) / viewport.zoom, y: (screenY - viewport.panY) / viewport.zoom };
}

export function worldToScreen(worldX: number, worldY: number, viewport: Viewport): { x: number; y: number } {
  return { x: worldX * viewport.zoom + viewport.panX, y: worldY * viewport.zoom + viewport.panY };
}

/** Converts a raw screen-pixel pointer-movement delta into the equivalent
 * world-pixel delta at the given zoom — used by Token.tsx's drag math, which
 * accumulates left/top in world units but only ever observes movement via
 * screen-space clientX/clientY. Dividing by zoom here is the fix for the
 * pre-existing bug where drag distance desynced from the cursor at any zoom
 * other than 100%. */
export function screenDeltaToWorld(dxScreen: number, dyScreen: number, zoom: number): { dx: number; dy: number } {
  return { dx: dxScreen / zoom, dy: dyScreen / zoom };
}

/** Rescales a viewport so the world point currently under (screenX, screenY)
 * stays under it after zooming to targetZoom — used for cursor-anchored
 * wheel zoom, pinch-zoom, and the zoom in/out/reset buttons (anchored at the
 * container's center in that case). targetZoom is NOT clamped here — callers
 * clamp before calling so the anchor math and the min/max policy stay
 * separately testable. */
export function zoomAtPoint(screenX: number, screenY: number, targetZoom: number, viewport: Viewport): Viewport {
  return {
    zoom: targetZoom,
    panX: screenX - ((screenX - viewport.panX) * targetZoom) / viewport.zoom,
    panY: screenY - ((screenY - viewport.panY) * targetZoom) / viewport.zoom,
  };
}

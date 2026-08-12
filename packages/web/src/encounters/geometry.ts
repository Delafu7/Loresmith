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

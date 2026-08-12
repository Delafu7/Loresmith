import { describe, expect, it } from 'vitest';
import { cellToPx, pxToCell, cellsToFeet, feetToCells, segmentToPx, snapToGridEdge, snapToCell } from './geometry';

describe('grid<->pixel<->feet conversions', () => {
  it('cellToPx/pxToCell round-trip', () => {
    expect(cellToPx(3, 50)).toBe(150);
    expect(pxToCell(150, 50)).toBe(3);
  });

  it('cellsToFeet/feetToCells round-trip', () => {
    expect(cellsToFeet(4, 5)).toBe(20);
    expect(feetToCells(20, 5)).toBe(4);
  });

  it('segmentToPx converts both endpoints independently', () => {
    expect(segmentToPx(1, 2, 4, 6, 10)).toEqual({ x1: 10, y1: 20, x2: 40, y2: 60 });
  });

  it('snapToGridEdge rounds to the nearest cell-size multiple', () => {
    expect(snapToGridEdge(24, 50)).toBe(0);
    expect(snapToGridEdge(26, 50)).toBe(50);
    expect(snapToGridEdge(75, 50)).toBe(100);
  });

  it('snapToCell rounds a pixel offset to the nearest whole cell index', () => {
    expect(snapToCell(24, 50)).toBe(0);
    expect(snapToCell(26, 50)).toBe(1);
    expect(snapToCell(149, 50)).toBe(3);
  });
});

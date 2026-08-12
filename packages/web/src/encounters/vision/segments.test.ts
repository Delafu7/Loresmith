import { describe, expect, it } from 'vitest';
import { wallSegmentsFromElements } from './segments';
import type { MapElement } from '../../lib/types';

const BASE = { id: 'el-1', mapId: 'map-1', label: null, visibleToPlayers: true, locked: false, zIndex: 0 };

describe('wallSegmentsFromElements', () => {
  it('includes a wall and excludes a point-only note element', () => {
    const wall: MapElement = { ...BASE, type: 'wall', x1: 0, y1: 0, x2: 2, y2: 0, points: null, props: {} };
    const note: MapElement = { ...BASE, id: 'el-2', type: 'note', x1: 1, y1: 1, x2: null, y2: null, points: null, props: { body: 'hi' } };
    const segments = wallSegmentsFromElements([wall, note], 10);
    expect(segments).toEqual([{ x1: 0, y1: 0, x2: 20, y2: 0 }]);
  });

  it('includes a closed/locked door but excludes an open one', () => {
    const closed: MapElement = { ...BASE, id: 'el-2', type: 'door', x1: 0, y1: 0, x2: 1, y2: 0, points: null, props: { state: 'closed' } };
    const locked: MapElement = { ...BASE, id: 'el-3', type: 'door', x1: 0, y1: 1, x2: 1, y2: 1, points: null, props: { state: 'locked' } };
    const open: MapElement = { ...BASE, id: 'el-4', type: 'door', x1: 0, y1: 2, x2: 1, y2: 2, points: null, props: { state: 'open' } };
    const segments = wallSegmentsFromElements([closed, locked, open], 10);
    expect(segments.length).toBe(2);
  });
});

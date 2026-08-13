import { describe, expect, it } from 'vitest';
import { wallSegmentsFromElements } from './segments';
import type { MapElement, RedactedMapElement } from '../../lib/types';

const BASE = { id: 'el-1', mapId: 'map-1', label: null, visibility: 'revealed_to_players' as const, ownerUserId: null, locked: false, zIndex: 0 };

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

  // GM-only visibility layer — a hidden wall/door arrives as a redacted
  // geometry-only stub for a non-DM/non-owner viewer; raycasting must still
  // pick it up (that's the whole point of redacting instead of omitting).
  it('includes a redacted wall/door stub the same as a full one', () => {
    const redactedWall: RedactedMapElement = { id: 'w1', mapId: 'map-1', type: 'wall', x1: 0, y1: 0, x2: 2, y2: 0, redacted: true, blocksVision: true };
    const redactedOpenDoor: RedactedMapElement = { id: 'd1', mapId: 'map-1', type: 'door', x1: 0, y1: 1, x2: 1, y2: 1, redacted: true, blocksVision: false };
    const segments = wallSegmentsFromElements([redactedWall, redactedOpenDoor], 10);
    expect(segments).toEqual([{ x1: 0, y1: 0, x2: 20, y2: 0 }]);
  });
});

import { describe, expect, it } from 'vitest';
import { ELEMENT_REGISTRY, ELEMENT_TYPES, elementBlocksMovement, elementBlocksVision } from './registry';
import type { MapElement, RedactedMapElement } from '../../lib/types';

const BASE = {
  id: 'el-1',
  mapId: 'map-1',
  x1: 0,
  y1: 0,
  x2: null,
  y2: null,
  label: null,
  visibility: 'revealed_to_players' as const,
  ownerUserId: null,
  locked: false,
  zIndex: 0,
};

describe('ELEMENT_REGISTRY', () => {
  it('has exactly one entry per declared type, matching ELEMENT_TYPES', () => {
    expect(Object.keys(ELEMENT_REGISTRY).sort()).toEqual([...ELEMENT_TYPES].sort());
  });

  it('every entry produces valid defaults() with a props object', () => {
    for (const type of ELEMENT_TYPES) {
      const d = ELEMENT_REGISTRY[type].defaults();
      expect(d.props).toBeTypeOf('object');
      expect(d.props).not.toBeNull();
    }
  });

  it("every entry's field keys are present in its own defaults().props (property panel never targets a key defaults() doesn't seed)", () => {
    for (const type of ELEMENT_TYPES) {
      const entry = ELEMENT_REGISTRY[type];
      const d = entry.defaults();
      for (const field of entry.fields) {
        expect(Object.prototype.hasOwnProperty.call(d.props, field.key), `${type}.${field.key} missing from defaults().props`).toBe(true);
      }
    }
  });

  it('a wall always blocks vision and movement', () => {
    const wall: MapElement = { ...BASE, type: 'wall', points: null, props: {} };
    expect(elementBlocksVision(wall)).toBe(true);
    expect(elementBlocksMovement(wall)).toBe(true);
  });

  it('a door blocks vision unless open, and blocks movement only when locked', () => {
    const doorAt = (state: 'open' | 'closed' | 'locked'): MapElement => ({ ...BASE, type: 'door', points: null, props: { state } });

    expect(elementBlocksVision(doorAt('open'))).toBe(false);
    expect(elementBlocksVision(doorAt('closed'))).toBe(true);
    expect(elementBlocksVision(doorAt('locked'))).toBe(true);

    expect(elementBlocksMovement(doorAt('open'))).toBe(false);
    expect(elementBlocksMovement(doorAt('closed'))).toBe(false);
    expect(elementBlocksMovement(doorAt('locked'))).toBe(true);
  });

  it('light/area/note/image never block vision or movement', () => {
    const nonBlocking: MapElement[] = [
      { ...BASE, type: 'light', points: null, props: { brightRadiusFt: 20, dimRadiusFt: 40, color: '#fff', intensity: 0.5 } },
      { ...BASE, type: 'area', points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }], props: { shape: 'polygon', costType: 'difficult', color: '#fff' } },
      { ...BASE, type: 'note', points: null, props: { body: 'hi' } },
      { ...BASE, type: 'image', points: null, props: { assetId: null, widthFt: 5, heightFt: 5, rotationDeg: 0, opacity: 1 } },
    ];
    for (const el of nonBlocking) {
      expect(elementBlocksVision(el)).toBe(false);
      expect(elementBlocksMovement(el)).toBe(false);
    }
  });

  it('note defaults to gm_only; every other type defaults to visible (or leaves it server-defaulted)', () => {
    expect(ELEMENT_REGISTRY.note.defaults().visibility).toBe('gm_only');
  });

  // GM-only visibility layer — a hidden wall/door/light arrives from the
  // server as a RedactedMapElement (geometry-only) stub, not a full
  // MapElement; elementBlocksVision must short-circuit on it before
  // indexing the type registry (needed by vision/segments.ts's raycasting).
  it('elementBlocksVision reads a redacted element stub\'s own blocksVision fact, never the type registry', () => {
    const redactedWall: RedactedMapElement = { id: 'w1', mapId: 'map-1', type: 'wall', x1: 0, y1: 0, x2: 1, y2: 0, redacted: true, blocksVision: true };
    const redactedOpenDoor: RedactedMapElement = { id: 'd1', mapId: 'map-1', type: 'door', x1: 0, y1: 0, x2: 1, y2: 0, redacted: true, blocksVision: false };
    const redactedClosedDoor: RedactedMapElement = { id: 'd2', mapId: 'map-1', type: 'door', x1: 0, y1: 0, x2: 1, y2: 0, redacted: true, blocksVision: true };

    expect(elementBlocksVision(redactedWall)).toBe(true);
    expect(elementBlocksVision(redactedOpenDoor)).toBe(false);
    expect(elementBlocksVision(redactedClosedDoor)).toBe(true);
  });

  it('wall and door are segment-placed; light/note/image are point-placed; area is polygon-placed', () => {
    expect(ELEMENT_REGISTRY.wall.placement).toBe('segment');
    expect(ELEMENT_REGISTRY.door.placement).toBe('segment');
    expect(ELEMENT_REGISTRY.light.placement).toBe('point');
    expect(ELEMENT_REGISTRY.note.placement).toBe('point');
    expect(ELEMENT_REGISTRY.image.placement).toBe('point');
    expect(ELEMENT_REGISTRY.area.placement).toBe('polygon');
  });
});

import { describe, expect, it } from 'vitest';
import { computeVisibleParticipantIds, hasLineOfSight, segmentsIntersect, wallSegmentsFromElements } from './vision.js';

describe('segmentsIntersect', () => {
  it('detects a crossing pair of segments', () => {
    expect(segmentsIntersect({ x: 0, y: 0 }, { x: 4, y: 4 }, { x1: 0, y1: 4, x2: 4, y2: 0 })).toBe(true);
  });

  it('does not flag parallel segments', () => {
    expect(segmentsIntersect({ x: 0, y: 0 }, { x: 4, y: 0 }, { x1: 0, y1: 1, x2: 4, y2: 1 })).toBe(false);
  });

  it('does not flag a shared endpoint as blocking (standing in a doorway)', () => {
    expect(segmentsIntersect({ x: 0, y: 0 }, { x: 4, y: 4 }, { x1: 4, y1: 4, x2: 4, y2: 0 })).toBe(false);
  });

  it('does not flag segments that would only cross if extended past their own span', () => {
    expect(segmentsIntersect({ x: 0, y: 0 }, { x: 1, y: 1 }, { x1: 5, y1: 0, x2: 5, y2: 5 })).toBe(false);
  });
});

describe('hasLineOfSight', () => {
  it('is true with no walls in the way', () => {
    expect(hasLineOfSight({ x: 0, y: 0 }, { x: 10, y: 0 }, [])).toBe(true);
  });

  it('is false when a wall segment crosses the sightline', () => {
    const wall = { x1: 5, y1: -5, x2: 5, y2: 5 };
    expect(hasLineOfSight({ x: 0, y: 0 }, { x: 10, y: 0 }, [wall])).toBe(false);
  });

  it('is true when the wall is beyond the target, not between viewer and target', () => {
    const wall = { x1: 20, y1: -5, x2: 20, y2: 5 };
    expect(hasLineOfSight({ x: 0, y: 0 }, { x: 10, y: 0 }, [wall])).toBe(true);
  });
});

describe('wallSegmentsFromElements', () => {
  it('includes only elements whose blocksVision is true and that have full segment geometry', () => {
    const segments = wallSegmentsFromElements([
      { x1: 0, y1: 0, x2: 5, y2: 0, blocksVision: true },
      { x1: 0, y1: 0, x2: 5, y2: 5, blocksVision: false }, // open door
      { x1: 0, y1: 0, x2: null, y2: null, blocksVision: true }, // point element, e.g. a light
    ]);
    expect(segments).toEqual([{ x1: 0, y1: 0, x2: 5, y2: 0 }]);
  });
});

describe('computeVisibleParticipantIds', () => {
  const feetPerCell = 5;

  it('always includes every player-faction participant, regardless of range', () => {
    const participants = [
      { participantId: 'ally-far', ownerUserId: null, faction: 'player' as const, posX: 1000, posY: 1000, visionEnabled: true, visionRadiusFt: 30, darkvisionRadiusFt: 0 },
      { participantId: 'viewer-pc', ownerUserId: 'user-1', faction: 'player' as const, posX: 0, posY: 0, visionEnabled: true, visionRadiusFt: 30, darkvisionRadiusFt: 0 },
    ];
    const visible = computeVisibleParticipantIds('user-1', participants, [], feetPerCell);
    expect(visible).toEqual(new Set(['ally-far', 'viewer-pc']));
  });

  it('sees an enemy within range and in line of sight', () => {
    const participants = [
      { participantId: 'pc', ownerUserId: 'user-1', faction: 'player' as const, posX: 0, posY: 0, visionEnabled: true, visionRadiusFt: 30, darkvisionRadiusFt: 0 },
      { participantId: 'goblin', ownerUserId: null, faction: 'enemy' as const, posX: 4, posY: 0, visionEnabled: true, visionRadiusFt: 30, darkvisionRadiusFt: 0 }, // 20ft away
    ];
    const visible = computeVisibleParticipantIds('user-1', participants, [], feetPerCell);
    expect(visible.has('goblin')).toBe(true);
  });

  it('does not see an enemy beyond vision range', () => {
    const participants = [
      { participantId: 'pc', ownerUserId: 'user-1', faction: 'player' as const, posX: 0, posY: 0, visionEnabled: true, visionRadiusFt: 30, darkvisionRadiusFt: 0 },
      { participantId: 'goblin', ownerUserId: null, faction: 'enemy' as const, posX: 100, posY: 0, visionEnabled: true, visionRadiusFt: 30, darkvisionRadiusFt: 0 },
    ];
    const visible = computeVisibleParticipantIds('user-1', participants, [], feetPerCell);
    expect(visible.has('goblin')).toBe(false);
  });

  it('extends range via darkvision', () => {
    const participants = [
      { participantId: 'pc', ownerUserId: 'user-1', faction: 'player' as const, posX: 0, posY: 0, visionEnabled: true, visionRadiusFt: 5, darkvisionRadiusFt: 60 },
      { participantId: 'goblin', ownerUserId: null, faction: 'enemy' as const, posX: 10, posY: 0, visionEnabled: true, visionRadiusFt: 30, darkvisionRadiusFt: 0 }, // 50ft away
    ];
    const visible = computeVisibleParticipantIds('user-1', participants, [], feetPerCell);
    expect(visible.has('goblin')).toBe(true);
  });

  it('a wall between viewer and target blocks visibility even in range', () => {
    const participants = [
      { participantId: 'pc', ownerUserId: 'user-1', faction: 'player' as const, posX: 0, posY: 0, visionEnabled: true, visionRadiusFt: 30, darkvisionRadiusFt: 0 },
      { participantId: 'goblin', ownerUserId: null, faction: 'enemy' as const, posX: 4, posY: 0, visionEnabled: true, visionRadiusFt: 30, darkvisionRadiusFt: 0 },
    ];
    const wall = [{ x1: 2, y1: -5, x2: 2, y2: 5 }];
    const visible = computeVisibleParticipantIds('user-1', participants, wall, feetPerCell);
    expect(visible.has('goblin')).toBe(false);
  });

  it('a viewer with no seated character sees only the always-visible party', () => {
    const participants = [
      { participantId: 'ally', ownerUserId: null, faction: 'player' as const, posX: 0, posY: 0, visionEnabled: true, visionRadiusFt: 30, darkvisionRadiusFt: 0 },
      { participantId: 'goblin', ownerUserId: null, faction: 'enemy' as const, posX: 1, posY: 0, visionEnabled: true, visionRadiusFt: 30, darkvisionRadiusFt: 0 },
    ];
    const visible = computeVisibleParticipantIds('user-with-no-pc', participants, [], feetPerCell);
    expect(visible).toEqual(new Set(['ally']));
  });

  it('a vision-disabled viewer character sees only the always-visible party', () => {
    const participants = [
      { participantId: 'pc', ownerUserId: 'user-1', faction: 'player' as const, posX: 0, posY: 0, visionEnabled: false, visionRadiusFt: 30, darkvisionRadiusFt: 0 },
      { participantId: 'goblin', ownerUserId: null, faction: 'enemy' as const, posX: 1, posY: 0, visionEnabled: true, visionRadiusFt: 30, darkvisionRadiusFt: 0 },
    ];
    const visible = computeVisibleParticipantIds('user-1', participants, [], feetPerCell);
    expect(visible).toEqual(new Set(['pc']));
  });
});

// Unit tests for the movement-cost pure functions (REFACTOR-PLAN.md §4).
// Scenarios drawn directly from docs/rules/movement.md §4's "what must be
// tested" list — especially the dash/difficult-terrain interaction, flagged
// there as the single most error-prone case (a naive "dash doubles movement,
// difficult terrain doubles cost, so 4x" implementation would be wrong).

import { describe, expect, it } from 'vitest';
import {
  computePathCost, computeReachableSet, computeOpportunityAttackTriggers, sizeRankFor,
  type MovementGrid, type MoverProfile, type ThreatSource,
} from './movement.js';

function emptyGrid(overrides: Partial<MovementGrid> = {}): MovementGrid {
  return {
    columns: 10,
    rows: 10,
    feetPerCell: 5,
    diagonalRule: 'flat',
    edition: '2024',
    overrides: new Map(),
    occupants: new Map(),
    walls: [],
    ...overrides,
  };
}

function mover(overrides: Partial<MoverProfile> = {}): MoverProfile {
  return {
    faction: 'player',
    sizeRank: 2, // Medium
    altSpeedsFt: {},
    isProne: false,
    ...overrides,
  };
}

describe('sizeRankFor', () => {
  it('ranks the six categories 0..5 and is case-insensitive', () => {
    expect(sizeRankFor('Tiny')).toBe(0);
    expect(sizeRankFor('small')).toBe(1);
    expect(sizeRankFor('Medium')).toBe(2);
    expect(sizeRankFor('Large')).toBe(3);
    expect(sizeRankFor('Huge')).toBe(4);
    expect(sizeRankFor('Gargantuan')).toBe(5);
  });

  it('falls back to Medium for unrecognized input', () => {
    expect(sizeRankFor('nonsense')).toBe(2);
    expect(sizeRankFor(undefined)).toBe(2);
  });
});

describe('computePathCost — normal terrain', () => {
  it('a straight orthogonal move costs exactly distance * feetPerCell', () => {
    const result = computePathCost(emptyGrid(), mover(), { x: 0, y: 0 }, { x: 3, y: 0 });
    expect(result).not.toBeNull();
    expect(result!.costFt).toBe(15); // 3 cells * 5 ft
  });

  it('a diagonal move under the flat rule costs the same per-cell as orthogonal', () => {
    const result = computePathCost(emptyGrid({ diagonalRule: 'flat' }), mover(), { x: 0, y: 0 }, { x: 3, y: 3 });
    expect(result!.costFt).toBe(15); // 3 diagonal cells * 5 ft, flat rule
  });

  it('staying in place costs 0', () => {
    const result = computePathCost(emptyGrid(), mover(), { x: 2, y: 2 }, { x: 2, y: 2 });
    expect(result!.costFt).toBe(0);
  });
});

describe('computePathCost — alternating 5/10/5 diagonal rule', () => {
  it('alternates base cost per diagonal step: 5, 10, 5, 10...', () => {
    const grid = emptyGrid({ diagonalRule: 'alternating_5_10_5' });
    // 4 diagonal steps: 5 + 10 + 5 + 10 = 30
    const result = computePathCost(grid, mover(), { x: 0, y: 0 }, { x: 4, y: 4 });
    expect(result!.costFt).toBe(30);
  });

  it('orthogonal steps never trigger the alternating charge', () => {
    const grid = emptyGrid({ diagonalRule: 'alternating_5_10_5' });
    const result = computePathCost(grid, mover(), { x: 0, y: 0 }, { x: 4, y: 0 });
    expect(result!.costFt).toBe(20); // 4 * 5 ft flat, no diagonal steps involved
  });
});

describe('computePathCost — difficult terrain', () => {
  it('doubles the cost of every cell it covers', () => {
    // rows: 1 — a single-row corridor, so there's no cheaper diagonal
    // detour around the difficult stretch for Dijkstra to find; the
    // straight-through cost is genuinely the minimum here.
    const grid = emptyGrid({ rows: 1 });
    for (let x = 1; x <= 3; x++) {
      grid.overrides.set(`${x},0`, { costType: 'difficult', medium: 'ground', specialCostFt: null });
    }
    const result = computePathCost(grid, mover(), { x: 0, y: 0 }, { x: 3, y: 0 });
    // 3 difficult cells * 5 ft * 2 = 30
    expect(result!.costFt).toBe(30);
  });

  it('two independent difficult-terrain sources on the same cell cap at double, not stack to 4x', () => {
    const grid = emptyGrid();
    // Cell (1,0) is both a difficult-terrain override AND occupied by a
    // passable (same-faction) participant — two distinct "difficult" sources.
    grid.overrides.set('1,0', { costType: 'difficult', medium: 'ground', specialCostFt: null });
    grid.occupants.set('1,0', { participantId: 'occupant-999', faction: 'player', sizeRank: 2, isIncapacitated: false });
    const result = computePathCost(grid, mover(), { x: 0, y: 0 }, { x: 1, y: 0 });
    expect(result!.costFt).toBe(10); // 5 * 2, not 5 * 4
  });

  it('impassable terrain has no legal path through it', () => {
    const grid = emptyGrid({ columns: 3, rows: 3 });
    // Wall off the only route from (0,0) to (2,0) along y=0 and y=1..2 too.
    for (let x = 0; x < 3; x++) {
      for (let y = 0; y < 3; y++) {
        if (x === 1) grid.overrides.set(`${x},${y}`, { costType: 'impassable', medium: 'ground', specialCostFt: null });
      }
    }
    const result = computePathCost(grid, mover(), { x: 0, y: 0 }, { x: 2, y: 0 });
    expect(result).toBeNull();
  });

  it('a special-cost cell uses the DM-authored exact cost, not doubled terrain math', () => {
    const grid = emptyGrid();
    grid.overrides.set('1,0', { costType: 'special', medium: 'ground', specialCostFt: 15 });
    const result = computePathCost(grid, mover(), { x: 0, y: 0 }, { x: 1, y: 0 });
    expect(result!.costFt).toBe(15);
  });

  // docs/roadmap/dnd-2024-gap-analysis.md P3-1 (ER-06) — a hidden pit trap
  // doesn't visibly cost extra movement to step onto (that's the whole
  // point of it being hidden); it falls through to the same normal-cost
  // path as an unlisted cell. Detecting the fall itself is a separate,
  // encounter-service-level concern (services/encounters.ts's
  // computeValidatedMoveCost's pitTriggered), not this pure cost function's.
  it('a pit cell costs normal movement, not difficult/impassable', () => {
    const grid = emptyGrid();
    grid.overrides.set('1,0', { costType: 'pit', medium: 'ground', specialCostFt: null, pitDepthFt: 20 });
    const result = computePathCost(grid, mover(), { x: 0, y: 0 }, { x: 1, y: 0 });
    expect(result!.costFt).toBe(5); // 1 cell * 5 ft, same as normal terrain
  });
});

describe('computePathCost — dash is a budget concern, not a cost-function concern', () => {
  // The pure cost function has no concept of "dash" at all — dash only ever
  // affects the caller's budget (speed_ft + speed_ft if dashing), never the
  // per-foot cost this function computes. This test proves the function's
  // output for a difficult-terrain path is IDENTICAL regardless of any
  // dash-related budget the caller might compare it against — i.e., it's
  // structurally impossible for this function to accidentally apply a "4x
  // difficult terrain when dashing" bug, since it never sees dash state.
  it('difficult-terrain path cost is unaffected by any notion of dash (dash lives entirely in the caller)', () => {
    const grid = emptyGrid({ rows: 1 });
    for (let x = 1; x <= 6; x++) {
      grid.overrides.set(`${x},0`, { costType: 'difficult', medium: 'ground', specialCostFt: null });
    }
    const result = computePathCost(grid, mover(), { x: 0, y: 0 }, { x: 6, y: 0 });
    // 6 difficult cells * 5 ft * 2 = 60 — a caller with speed 30 and
    // dash_used=true has a 60 ft budget and can afford exactly this,
    // covering 30 ft of real ground (6 cells * 5 ft) — matching
    // docs/rules/movement.md §1.5's worked example exactly.
    expect(result!.costFt).toBe(60);
  });
});

describe('computePathCost — occupancy passability', () => {
  it('a same-side (player/ally) occupied cell is passable, costs difficult-terrain rate', () => {
    const grid = emptyGrid();
    grid.occupants.set('1,0', { participantId: 'occupant-1', faction: 'ally', sizeRank: 2, isIncapacitated: false });
    const result = computePathCost(grid, mover({ faction: 'player' }), { x: 0, y: 0 }, { x: 1, y: 0 });
    expect(result!.costFt).toBe(10); // 5 * 2
  });

  it('2014: a hostile same-size occupant blocks the path outright', () => {
    const grid = emptyGrid({ columns: 3, rows: 1, edition: '2014' });
    grid.occupants.set('1,0', { participantId: 'occupant-1', faction: 'enemy', sizeRank: 2, isIncapacitated: false });
    const result = computePathCost(grid, mover({ faction: 'player', sizeRank: 2 }), { x: 0, y: 0 }, { x: 2, y: 0 });
    expect(result).toBeNull();
  });

  it('2014: a hostile occupant >=2 size categories different is passable (difficult-terrain rate)', () => {
    const grid = emptyGrid({ columns: 3, rows: 1, edition: '2014' });
    grid.occupants.set('1,0', { participantId: 'occupant-1', faction: 'enemy', sizeRank: 0, isIncapacitated: false }); // Tiny
    const result = computePathCost(grid, mover({ faction: 'player', sizeRank: 3 }), { x: 0, y: 0 }, { x: 2, y: 0 }); // Large mover
    expect(result!.costFt).toBe(15); // 5 (normal cell 1) + 10 (difficult cell 2)
  });

  it('2024: a same-size hostile occupant blocks; a Tiny hostile occupant is passable', () => {
    const grid2024 = emptyGrid({ columns: 3, rows: 1, edition: '2024' });
    grid2024.occupants.set('1,0', { participantId: 'occupant-1', faction: 'enemy', sizeRank: 2, isIncapacitated: false });
    expect(computePathCost(grid2024, mover({ faction: 'player', sizeRank: 2 }), { x: 0, y: 0 }, { x: 2, y: 0 })).toBeNull();

    const gridTiny = emptyGrid({ columns: 3, rows: 1, edition: '2024' });
    gridTiny.occupants.set('1,0', { participantId: 'occupant-1', faction: 'enemy', sizeRank: 0, isIncapacitated: false });
    const result = computePathCost(gridTiny, mover({ faction: 'player', sizeRank: 2 }), { x: 0, y: 0 }, { x: 2, y: 0 });
    expect(result!.costFt).toBe(15);
  });

  it('neutral faction is nonhostile to everyone (passable, difficult-terrain rate)', () => {
    const grid = emptyGrid();
    grid.occupants.set('1,0', { participantId: 'occupant-1', faction: 'neutral', sizeRank: 2, isIncapacitated: false });
    const result = computePathCost(grid, mover({ faction: 'enemy' }), { x: 0, y: 0 }, { x: 1, y: 0 });
    expect(result!.costFt).toBe(10);
  });

  // P2-1 (CB-01) — docs/roadmap/dnd-2024-gap-analysis.md. 2024-only:
  // rulesGlossary.md combat.md lines 59-64 adds Incapacitated to the
  // permitted-passthrough list; 2014's occupancy rule has no such exception.
  it('2024: a same-size hostile occupant that is Incapacitated is passable (difficult-terrain rate), where a non-Incapacitated one of the same size blocks', () => {
    const grid = emptyGrid({ columns: 3, rows: 1, edition: '2024' });
    grid.occupants.set('1,0', { participantId: 'occupant-1', faction: 'enemy', sizeRank: 2, isIncapacitated: true });
    const result = computePathCost(grid, mover({ faction: 'player', sizeRank: 2 }), { x: 0, y: 0 }, { x: 2, y: 0 });
    expect(result!.costFt).toBe(15); // 5 (normal cell 1) + 10 (difficult cell 2), same shape as the Tiny-exception case above
  });

  it('2014: an Incapacitated hostile occupant is NOT exempted — same-size hostile still blocks outright', () => {
    const grid = emptyGrid({ columns: 3, rows: 1, edition: '2014' });
    grid.occupants.set('1,0', { participantId: 'occupant-1', faction: 'enemy', sizeRank: 2, isIncapacitated: true });
    const result = computePathCost(grid, mover({ faction: 'player', sizeRank: 2 }), { x: 0, y: 0 }, { x: 2, y: 0 });
    expect(result).toBeNull();
  });
});

describe('computePathCost — alternate speeds and medium', () => {
  it('a matching alternate speed avoids the medium-mismatch penalty', () => {
    const grid = emptyGrid();
    grid.overrides.set('1,0', { costType: 'difficult', medium: 'water', specialCostFt: null });
    const swimmer = mover({ altSpeedsFt: { swim: 30 } });
    const result = computePathCost(grid, swimmer, { x: 0, y: 0 }, { x: 1, y: 0 });
    // water cell is ALSO cost_type='difficult' here, so still 2 layers (base
    // + difficult) even for a swimmer — medium mismatch is the 3rd layer
    // this swimmer avoids.
    expect(result!.costFt).toBe(10);
  });

  it('no matching alternate speed adds an extra layer on top of difficult terrain (2014 confirmed: 3x)', () => {
    const grid = emptyGrid({ edition: '2014' });
    grid.overrides.set('1,0', { costType: 'difficult', medium: 'water', specialCostFt: null });
    const nonSwimmer = mover({ altSpeedsFt: {} });
    const result = computePathCost(grid, nonSwimmer, { x: 0, y: 0 }, { x: 1, y: 0 });
    expect(result!.costFt).toBe(15); // 5 * (1 + 1 difficult + 1 medium-mismatch)
  });
});

describe('computePathCost — crawling (prone)', () => {
  it('crawling through difficult terrain costs 3x base, matching the confirmed 2014 example', () => {
    const grid = emptyGrid();
    grid.overrides.set('1,0', { costType: 'difficult', medium: 'ground', specialCostFt: null });
    const proneMover = mover({ isProne: true });
    const result = computePathCost(grid, proneMover, { x: 0, y: 0 }, { x: 1, y: 0 });
    expect(result!.costFt).toBe(15); // 5 * (1 + 1 difficult + 1 crawl)
  });

  it('crawling on normal terrain costs 2x base', () => {
    const proneMover = mover({ isProne: true });
    const result = computePathCost(emptyGrid(), proneMover, { x: 0, y: 0 }, { x: 1, y: 0 });
    expect(result!.costFt).toBe(10); // 5 * (1 + 1 crawl)
  });
});

describe('computeReachableSet', () => {
  it('includes the origin and every cell within budget, excludes cells beyond it', () => {
    const reachable = computeReachableSet(emptyGrid(), mover(), { x: 5, y: 5 }, 15);
    expect(reachable.has('5,5')).toBe(true);
    expect(reachable.has('8,5')).toBe(true); // 3 cells * 5 ft = 15, exactly at budget
    expect(reachable.has('9,5')).toBe(false); // 4 cells * 5 ft = 20, over budget
  });

  it('shrinks around difficult terrain', () => {
    // A single-row grid (rows: 1) rules out any diagonal detour around the
    // difficult cell — this is a real corridor, not just "usually" blocked,
    // so the test isn't sensitive to the flat diagonal rule letting a mover
    // sidestep a lone difficult cell for free.
    const grid = emptyGrid({ rows: 1 });
    grid.overrides.set('6,0', { costType: 'difficult', medium: 'ground', specialCostFt: null });
    const reachable = computeReachableSet(grid, mover(), { x: 5, y: 0 }, 15);
    // (5,0)->(6,0) difficult = 10, ->(7,0) = 5, ->(8,0) = 5: total 20 > 15.
    expect(reachable.has('8,0')).toBe(false);
    // Without the difficult cell in the way, 3 plain cells (15 ft) is exactly reachable.
    expect(reachable.has('3,0')).toBe(true);
  });
});

describe('wall movement blocking', () => {
  it('a wall segment crossing the straight line between two adjacent cells blocks that step', () => {
    // Vertical wall at x=1.5 (between column 1 and column 2), spanning every row.
    const grid = emptyGrid({ walls: [{ x1: 1.5, y1: -1, x2: 1.5, y2: 11 }] });
    const result = computePathCost(grid, mover(), { x: 0, y: 0 }, { x: 2, y: 0 });
    expect(result).toBeNull(); // the wall spans every row, so there's no detour around it
  });

  it('a mover can path around a wall that does not span the whole grid', () => {
    // Same vertical wall, but only rows 0-1 — row 2 is open.
    const grid = emptyGrid({ walls: [{ x1: 1.5, y1: -1, x2: 1.5, y2: 2 }] });
    const result = computePathCost(grid, mover(), { x: 0, y: 0 }, { x: 2, y: 0 });
    expect(result).not.toBeNull();
    expect(result!.costFt).toBeGreaterThan(10); // longer than the unobstructed 2-cell (10ft) straight line
  });

  it('a wall also blocks a diagonal step that crosses it', () => {
    // The OTHER diagonal of a 2x2 block, from (1,0) to (0,1) — crosses the
    // (0,0)->(1,1) diagonal at its true midpoint without touching either
    // orthogonal edge (it only meets them at shared endpoints, which the
    // strict interior intersection test in domain/vision.ts never treats
    // as blocking).
    const grid = emptyGrid({ columns: 2, rows: 2, walls: [{ x1: 1, y1: 0, x2: 0, y2: 1 }] });
    const result = computePathCost(grid, mover(), { x: 0, y: 0 }, { x: 1, y: 1 });
    // Flat diagonal rule prices a direct diagonal at the same 5ft as an
    // orthogonal step; with it blocked, the cheapest route is now the
    // two-step orthogonal detour via (1,0) or (0,1): 5 + 5 = 10ft.
    expect(result!.costFt).toBe(10);
  });

  it('a wall shrinks the reachable set exactly like difficult/impassable terrain', () => {
    const grid = emptyGrid({ rows: 1, walls: [{ x1: 6.5, y1: -1, x2: 6.5, y2: 2 }] }); // wall between column 6 and 7
    const reachable = computeReachableSet(grid, mover(), { x: 5, y: 0 }, 15);
    expect(reachable.has('6,0')).toBe(true); // short of the wall
    expect(reachable.has('7,0')).toBe(false); // wall blocks 6->7 entirely, no detour in a single row
  });

  it('a locked door blocks movement; a closed-but-unlocked door does not', () => {
    const lockedGrid = emptyGrid({ walls: [{ x1: 1.5, y1: -1, x2: 1.5, y2: 11 }] });
    expect(computePathCost(lockedGrid, mover(), { x: 0, y: 0 }, { x: 2, y: 0 })).toBeNull();

    // A closed-but-unlocked door contributes no wall segment at all
    // (loadMovementContext/computeBlocksMovement only includes locked
    // doors) — modeled here simply as an empty walls list.
    const openableGrid = emptyGrid({ walls: [] });
    const result = computePathCost(openableGrid, mover(), { x: 0, y: 0 }, { x: 2, y: 0 });
    expect(result).not.toBeNull();
    expect(result!.costFt).toBe(10);
  });
});

describe('computeOpportunityAttackTriggers', () => {
  function threat(overrides: Partial<ThreatSource> = {}): ThreatSource {
    return { participantId: 'threat-1', faction: 'enemy', x: 1, y: 0, canReact: true, ...overrides };
  }

  it('a straight-line move that starts adjacent to a hostile threat and leaves its reach triggers', () => {
    // mover walks (0,0) -> (1,0) -> (2,0) -> (3,0); threat sits at (0,1), reach 1 cell (5ft).
    // Reach covers (0,0) and (1,0) [Chebyshev distance 1] but not (2,0) [Chebyshev distance 2].
    const path = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }];
    const triggered = computeOpportunityAttackTriggers(path, 'player', 5, [threat({ x: 0, y: 1 })]);
    expect(triggered).toEqual(['threat-1']);
  });

  it('a move that stays within reach the whole time never triggers', () => {
    const path = [{ x: 0, y: 0 }, { x: 1, y: 0 }];
    const triggered = computeOpportunityAttackTriggers(path, 'player', 5, [threat({ x: 0, y: 1 })]);
    expect(triggered).toEqual([]);
  });

  it('a move that never enters reach at all never triggers', () => {
    const path = [{ x: 5, y: 5 }, { x: 6, y: 5 }, { x: 7, y: 5 }];
    const triggered = computeOpportunityAttackTriggers(path, 'player', 5, [threat({ x: 0, y: 1 })]);
    expect(triggered).toEqual([]);
  });

  it('same-side (party/party or foes/foes) threats never trigger, regardless of reach', () => {
    const path = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }];
    const ally = threat({ faction: 'ally', x: 0, y: 1 });
    expect(computeOpportunityAttackTriggers(path, 'player', 5, [ally])).toEqual([]);
  });

  it('a neutral threat, or a neutral mover, never triggers', () => {
    const path = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }];
    const neutralThreat = threat({ faction: 'neutral', x: 0, y: 1 });
    expect(computeOpportunityAttackTriggers(path, 'player', 5, [neutralThreat])).toEqual([]);
    const enemyThreat = threat({ faction: 'enemy', x: 0, y: 1 });
    expect(computeOpportunityAttackTriggers(path, 'neutral', 5, [enemyThreat])).toEqual([]);
  });

  it('a threat that cannot react (Incapacitated or reaction already spent) is excluded', () => {
    const path = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }];
    const unableToReact = threat({ x: 0, y: 1, canReact: false });
    expect(computeOpportunityAttackTriggers(path, 'player', 5, [unableToReact])).toEqual([]);
  });

  it('only ONE trigger per threat source even if the path leaves and re-enters its reach twice', () => {
    // Path goes 0,0 (in reach) -> 3,0 (out) -> 0,0 (in) -> 3,0 (out) again.
    const path = [{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 0, y: 0 }, { x: 3, y: 0 }];
    const triggered = computeOpportunityAttackTriggers(path, 'player', 5, [threat({ x: 0, y: 1 })]);
    expect(triggered).toEqual(['threat-1']);
  });

  it('multiple independent threat sources can each trigger from the same move', () => {
    const path = [{ x: 0, y: 0 }, { x: 5, y: 0 }];
    const near1 = threat({ participantId: 'threat-near', x: 0, y: 1 });
    const near2 = threat({ participantId: 'threat-far', x: 5, y: 1 });
    // near2 is only in reach of the DESTINATION, never left mid-path, so it must NOT trigger.
    const triggered = computeOpportunityAttackTriggers(path, 'player', 5, [near1, near2]);
    expect(triggered).toEqual(['threat-near']);
  });

  it('a diagonally-adjacent threat still counts as "within reach" (Chebyshev distance, not Euclidean)', () => {
    // threat at (1,1): Chebyshev distance to (0,0) is 1 (within reach, diagonal);
    // Euclidean distance would be sqrt(2)*5ft =~ 7ft, which would WRONGLY fall
    // outside a naive Euclidean 5ft check — this proves the grid convention wins.
    const path = [{ x: 0, y: 0 }, { x: 5, y: 5 }];
    const diagonalThreat = threat({ x: 1, y: 1 });
    expect(computeOpportunityAttackTriggers(path, 'player', 5, [diagonalThreat])).toEqual(['threat-1']);
  });

  it('an empty or single-point path never triggers', () => {
    expect(computeOpportunityAttackTriggers([], 'player', 5, [threat({ x: 0, y: 0 })])).toEqual([]);
    expect(computeOpportunityAttackTriggers([{ x: 0, y: 0 }], 'player', 5, [threat({ x: 0, y: 0 })])).toEqual([]);
  });
});

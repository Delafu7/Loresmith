// Unit tests for the movement-cost pure functions (REFACTOR-PLAN.md §4).
// Scenarios drawn directly from docs/rules/movement.md §4's "what must be
// tested" list — especially the dash/difficult-terrain interaction, flagged
// there as the single most error-prone case (a naive "dash doubles movement,
// difficult terrain doubles cost, so 4x" implementation would be wrong).

import { describe, expect, it } from 'vitest';
import { computePathCost, computeReachableSet, sizeRankFor, type MovementGrid, type MoverProfile } from './movement.js';

function emptyGrid(overrides: Partial<MovementGrid> = {}): MovementGrid {
  return {
    columns: 10,
    rows: 10,
    feetPerCell: 5,
    diagonalRule: 'flat',
    edition: '2024',
    overrides: new Map(),
    occupants: new Map(),
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
    grid.occupants.set('1,0', { participantId: 'occupant-999', faction: 'player', sizeRank: 2 });
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
    grid.occupants.set('1,0', { participantId: 'occupant-1', faction: 'ally', sizeRank: 2 });
    const result = computePathCost(grid, mover({ faction: 'player' }), { x: 0, y: 0 }, { x: 1, y: 0 });
    expect(result!.costFt).toBe(10); // 5 * 2
  });

  it('2014: a hostile same-size occupant blocks the path outright', () => {
    const grid = emptyGrid({ columns: 3, rows: 1, edition: '2014' });
    grid.occupants.set('1,0', { participantId: 'occupant-1', faction: 'enemy', sizeRank: 2 });
    const result = computePathCost(grid, mover({ faction: 'player', sizeRank: 2 }), { x: 0, y: 0 }, { x: 2, y: 0 });
    expect(result).toBeNull();
  });

  it('2014: a hostile occupant >=2 size categories different is passable (difficult-terrain rate)', () => {
    const grid = emptyGrid({ columns: 3, rows: 1, edition: '2014' });
    grid.occupants.set('1,0', { participantId: 'occupant-1', faction: 'enemy', sizeRank: 0 }); // Tiny
    const result = computePathCost(grid, mover({ faction: 'player', sizeRank: 3 }), { x: 0, y: 0 }, { x: 2, y: 0 }); // Large mover
    expect(result!.costFt).toBe(15); // 5 (normal cell 1) + 10 (difficult cell 2)
  });

  it('2024: a same-size hostile occupant blocks; a Tiny hostile occupant is passable', () => {
    const grid2024 = emptyGrid({ columns: 3, rows: 1, edition: '2024' });
    grid2024.occupants.set('1,0', { participantId: 'occupant-1', faction: 'enemy', sizeRank: 2 });
    expect(computePathCost(grid2024, mover({ faction: 'player', sizeRank: 2 }), { x: 0, y: 0 }, { x: 2, y: 0 })).toBeNull();

    const gridTiny = emptyGrid({ columns: 3, rows: 1, edition: '2024' });
    gridTiny.occupants.set('1,0', { participantId: 'occupant-1', faction: 'enemy', sizeRank: 0 });
    const result = computePathCost(gridTiny, mover({ faction: 'player', sizeRank: 2 }), { x: 0, y: 0 }, { x: 2, y: 0 });
    expect(result!.costFt).toBe(15);
  });

  it('neutral faction is nonhostile to everyone (passable, difficult-terrain rate)', () => {
    const grid = emptyGrid();
    grid.occupants.set('1,0', { participantId: 'occupant-1', faction: 'neutral', sizeRank: 2 });
    const result = computePathCost(grid, mover({ faction: 'enemy' }), { x: 0, y: 0 }, { x: 1, y: 0 });
    expect(result!.costFt).toBe(10);
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

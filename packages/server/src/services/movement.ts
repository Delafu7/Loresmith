// Movement-cost pathfinding (REFACTOR-PLAN.md §4). Pure functions, no DB/
// Express dependency — same "pure-function-first" precedent as services/hp.ts
// and services/spellSlots.ts, so the cost math is unit-testable without a
// live database and reusable from both the position-update validation path
// and the reachable-cells read endpoint.
//
// Grounded in docs/rules/movement.md (consult that file for the full SRD
// citations this implements). Known, deliberate simplifications relative to
// that doc's full findings — see OPEN_QUESTIONS.md #6 for the product-level
// framing:
//   - 2024's occupancy passability exception for "Incapacitated" creatures is
//     NOT implemented (this app has no queryable Incapacitated predicate —
//     active_effects stores applied conditions by name, not structured
//     booleans). 2024 occupancy here is: same-side, Tiny, or >=2 size
//     categories different.
//   - Multi-speed switching (fly/swim/climb/burrow) is modeled as a single
//     numeric budget with a per-cell cost multiplier when the cell's medium
//     doesn't match one of the mover's alternate speeds, NOT the SRD's
//     "each speed is an independent ceiling against a shared distance-moved
//     total" mechanic (docs/rules/movement.md §1.4). Correct for the common
//     case (one relevant alternate speed for the terrain being crossed);
//     imprecise for a mover switching between two different alternate
//     speeds mid-path.

export type CostType = 'difficult' | 'impassable' | 'special';
export type Medium = 'ground' | 'water' | 'air' | 'underground';
export type Faction = 'player' | 'ally' | 'enemy' | 'neutral';
export type DiagonalRule = 'flat' | 'alternating_5_10_5';

export interface CellOverride {
  costType: CostType;
  medium: Medium;
  specialCostFt: number | null;
}

export interface Occupant {
  participantId: string;
  faction: Faction;
  sizeRank: number; // 0=Tiny .. 5=Gargantuan, see SIZE_RANK below
}

export interface MovementGrid {
  columns: number;
  rows: number;
  feetPerCell: number;
  diagonalRule: DiagonalRule;
  edition: '2014' | '2024';
  /** key `${x},${y}` */
  overrides: Map<string, CellOverride>;
  /** key `${x},${y}` — every OTHER participant's current cell; excludes the mover. */
  occupants: Map<string, Occupant>;
}

export interface MoverProfile {
  faction: Faction;
  sizeRank: number;
  altSpeedsFt: { fly?: number; swim?: number; climb?: number; burrow?: number };
  /** Crawling — SRD "moving while prone" penalty (docs/rules/movement.md §1.6). */
  isProne: boolean;
}

export interface PathStep {
  x: number;
  y: number;
}

export interface PathResult {
  costFt: number;
  path: PathStep[];
}

export const SIZE_RANK: Record<string, number> = {
  Tiny: 0,
  Small: 1,
  Medium: 2,
  Large: 3,
  Huge: 4,
  Gargantuan: 5,
};

export function sizeRankFor(raw: string | null | undefined): number {
  const trimmed = raw?.trim();
  const match = Object.keys(SIZE_RANK).find((k) => k.toLowerCase() === trimmed?.toLowerCase());
  return match ? SIZE_RANK[match]! : SIZE_RANK.Medium!;
}

function key(x: number, y: number): string {
  return `${x},${y}`;
}

// docs/rules/movement.md §1.7: mapping this app's 4-state faction enum onto
// each edition's "hostile/nonhostile"-shaped rule. player+ally are one
// "side"; enemy is the other; neutral belongs to neither and is treated as
// nonhostile to everyone (matching 2014's blanket "nonhostile" reading, and
// giving 2024's narrower list a defined behavior for a faction value 2024's
// own enumerated text doesn't explicitly cover — see docs/rules/movement.md
// §1.7's "confirmed edition difference #2").
function sideOf(faction: Faction): 'party' | 'foes' | 'neutral' {
  if (faction === 'player' || faction === 'ally') return 'party';
  if (faction === 'enemy') return 'foes';
  return 'neutral';
}

function isOccupantPassable(mover: MoverProfile, occupant: Occupant, edition: '2014' | '2024'): boolean {
  const sizeDiff = Math.abs(occupant.sizeRank - mover.sizeRank);
  if (sizeDiff >= 2) return true;

  const moverSide = sideOf(mover.faction);
  const occupantSide = sideOf(occupant.faction);
  const sameSide = moverSide === occupantSide || moverSide === 'neutral' || occupantSide === 'neutral';

  if (edition === '2014') {
    // "You can move through a nonhostile creature's space." Hostile means
    // opposing sides; neutral is nonhostile to everyone.
    return sameSide;
  }
  // 2024: ally (same side) or Tiny, or the size-difference check above.
  return sameSide || occupant.sizeRank === 0;
}

/** True if entering this cell requires an alternate speed the mover doesn't have. */
function mediumMismatch(medium: Medium, mover: MoverProfile): boolean {
  if (medium === 'ground') return false;
  const key = medium === 'water' ? 'swim' : medium === 'air' ? 'fly' : 'burrow';
  return !mover.altSpeedsFt[key];
}

interface StepCost {
  costFt: number;
  /** Whether this destination cell is enterable at all. */
  passable: boolean;
}

// docs/rules/movement.md §2.3/§1.6: cost = baseStepCost * (1 + one bump per
// applicable penalty layer) — reproduces the confirmed 2014 worked example
// (crawling through difficult terrain = 3x base: 1 always-on + 1 difficult +
// 1 crawl) using whatever the base per-step charge is (which itself already
// accounts for the diagonal rule), rather than hardcoding "double."
function computeStepCost(
  grid: MovementGrid,
  mover: MoverProfile,
  toX: number,
  toY: number,
  baseStepCost: number,
): StepCost {
  const occupant = grid.occupants.get(key(toX, toY));
  if (occupant && !isOccupantPassable(mover, occupant, grid.edition)) {
    return { costFt: 0, passable: false };
  }
  const occupiedButPassable = occupant != null;

  const override = grid.overrides.get(key(toX, toY));
  if (override?.costType === 'impassable') {
    return { costFt: 0, passable: false };
  }
  if (override?.costType === 'special' && override.specialCostFt != null) {
    // DM-authored exact cost — stands alone, not combined with the other
    // additive layers (the DM already accounts for whatever they want here).
    return { costFt: override.specialCostFt, passable: true };
  }

  const isDifficult = override?.costType === 'difficult' || occupiedButPassable;
  const isMediumMismatch = override ? mediumMismatch(override.medium, mover) : false;
  const layers = 1 + (isDifficult ? 1 : 0) + (isMediumMismatch ? 1 : 0) + (mover.isProne ? 1 : 0);

  return { costFt: baseStepCost * layers, passable: true };
}

function neighborsOf(x: number, y: number, columns: number, rows: number): PathStep[] {
  const out: PathStep[] = [];
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      if (dx === 0 && dy === 0) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= columns || ny >= rows) continue;
      out.push({ x: nx, y: ny });
    }
  }
  return out;
}

// State includes diagonal parity (0 or 1) only when it matters
// (alternating_5_10_5) — under 'flat' every state collapses to parity 0, so
// the extra dimension is free (visited set just never uses parity 1).
interface SearchState {
  x: number;
  y: number;
  parity: 0 | 1;
}

function stateKey(s: SearchState): string {
  return `${s.x},${s.y},${s.parity}`;
}

/** Dijkstra over (x, y, diagonal-parity) states — grid is capped at 50x50
 * (GRID_MAX, schemas/encounters.ts), so a simple O(V^2) scan (no heap) is
 * plenty fast at this scale (<=5000 states). */
function dijkstra(
  grid: MovementGrid,
  mover: MoverProfile,
  from: PathStep,
  budgetFt: number | null, // null = unbounded (used by computePathCost before comparing to a caller-supplied budget)
): { dist: Map<string, number>; prev: Map<string, SearchState | null>; startState: SearchState } {
  const startState: SearchState = { x: from.x, y: from.y, parity: 0 };
  const dist = new Map<string, number>([[stateKey(startState), 0]]);
  const prev = new Map<string, SearchState | null>([[stateKey(startState), null]]);
  const visited = new Set<string>();

  for (;;) {
    let currentKey: string | null = null;
    let currentDist = Infinity;
    for (const [k, d] of dist) {
      if (!visited.has(k) && d < currentDist) {
        currentDist = d;
        currentKey = k;
      }
    }
    if (currentKey === null) break;
    visited.add(currentKey);
    if (budgetFt != null && currentDist > budgetFt) continue;

    const [cx, cy, cp] = currentKey.split(',').map(Number);
    const current: SearchState = { x: cx!, y: cy!, parity: cp as 0 | 1 };

    for (const n of neighborsOf(current.x, current.y, grid.columns, grid.rows)) {
      const isDiagonal = n.x !== current.x && n.y !== current.y;
      let baseStepCost = grid.feetPerCell;
      let nextParity: 0 | 1 = current.parity;
      if (isDiagonal && grid.diagonalRule === 'alternating_5_10_5') {
        // Every other diagonal step costs double the base (the "10 ft"
        // step in the classic 5/10/5 pattern); parity flips each diagonal
        // step taken, orthogonal steps don't touch it.
        baseStepCost = current.parity === 1 ? grid.feetPerCell * 2 : grid.feetPerCell;
        nextParity = current.parity === 1 ? 0 : 1;
      }

      const step = computeStepCost(grid, mover, n.x, n.y, baseStepCost);
      if (!step.passable) continue;

      const nextState: SearchState = { x: n.x, y: n.y, parity: nextParity };
      const nk = stateKey(nextState);
      const candidateDist = currentDist + step.costFt;
      if (candidateDist < (dist.get(nk) ?? Infinity)) {
        dist.set(nk, candidateDist);
        prev.set(nk, current);
      }
    }
  }

  return { dist, prev, startState };
}

function bestDistToCell(dist: Map<string, number>, x: number, y: number): { distance: number; parity: 0 | 1 } | null {
  const d0 = dist.get(stateKey({ x, y, parity: 0 }));
  const d1 = dist.get(stateKey({ x, y, parity: 1 }));
  if (d0 == null && d1 == null) return null;
  if (d0 == null) return { distance: d1!, parity: 1 };
  if (d1 == null) return { distance: d0, parity: 0 };
  return d0 <= d1 ? { distance: d0, parity: 0 } : { distance: d1, parity: 1 };
}

/** Cheapest path from `from` to `to`, or null if `to` is unreachable at all
 * (fully blocked — impassable terrain / an unpassable occupant everywhere). */
export function computePathCost(grid: MovementGrid, mover: MoverProfile, from: PathStep, to: PathStep): PathResult | null {
  if (from.x === to.x && from.y === to.y) return { costFt: 0, path: [from] };
  const { dist, prev } = dijkstra(grid, mover, from, null);
  const best = bestDistToCell(dist, to.x, to.y);
  if (!best) return null;

  const path: PathStep[] = [];
  let cursor: SearchState | null = { x: to.x, y: to.y, parity: best.parity };
  while (cursor) {
    path.unshift({ x: cursor.x, y: cursor.y });
    cursor = prev.get(stateKey(cursor)) ?? null;
  }
  return { costFt: best.distance, path };
}

/** Every cell reachable from `from` for at most `budgetFt`, for client-side
 * "highlight reachable cells" rendering. Returns cell keys (`${x},${y}`),
 * not full paths — the caller only needs the set for highlighting. */
export function computeReachableSet(grid: MovementGrid, mover: MoverProfile, from: PathStep, budgetFt: number): Set<string> {
  const { dist } = dijkstra(grid, mover, from, budgetFt);
  const reachable = new Set<string>();
  for (const [k, d] of dist) {
    if (d > budgetFt) continue;
    const [x, y] = k.split(',');
    reachable.add(`${x},${y}`);
  }
  return reachable;
}

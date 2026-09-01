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
//   - docs/roadmap/dnd-2024-gap-analysis.md P2-1 (CB-01) closed the
//     Incapacitated occupancy gap OPEN_QUESTIONS.md #6 originally flagged
//     here — Occupant.isIncapacitated (below) is now a caller-supplied
//     boolean, derived server-side (services/encounters.ts's
//     loadMovementContext) by matching each occupant's active effect names
//     against the 5 conditions whose OWN 2024 text composes "you have the
//     Incapacitated condition" (rulesGlossary.md: Incapacitated itself,
//     Paralyzed line 1223, Petrified line 1255, Stunned line 1543,
//     Unconscious line 1653) — this module stays trait-agnostic per its own
//     established convention (see diceEngine.ts's header comment on the same
//     principle) and never looks up effects itself.
//   - Multi-speed switching (fly/swim/climb/burrow) is modeled as a single
//     numeric budget with a per-cell cost multiplier when the cell's medium
//     doesn't match one of the mover's alternate speeds, NOT the SRD's
//     "each speed is an independent ceiling against a shared distance-moved
//     total" mechanic (docs/rules/movement.md §1.4). Correct for the common
//     case (one relevant alternate speed for the terrain being crossed);
//     imprecise for a mover switching between two different alternate
//     speeds mid-path.
//
// Wall movement blocking reuses domain/vision.ts's segment-intersection
// primitive rather than a second implementation: a wall/locked-door blocks
// a step between two adjacent cells exactly when it crosses the straight
// line between those two cells' positions — the same geometric test
// hasLineOfSight already does for vision, just applied to one grid step at
// a time instead of an arbitrary token-to-token sightline.

import { hasLineOfSight, type Point, type Segment } from '../domain/vision.js';

// docs/roadmap/dnd-2024-gap-analysis.md P3-1 (ER-06) — 'pit' is a NEW cost
// type, but deliberately NOT handled as a cost branch in computeStepCost
// below: a hidden pit trap doesn't visibly cost extra movement to step onto
// (that's the whole point of it being hidden), it falls through to the same
// normal-cost path as an unlisted cell. Detecting/resolving the actual fall
// is a separate concern (services/encounters.ts's computeValidatedMoveCost
// reports pitTriggered from the destination cell's override; resolving the
// fall itself is services/fallDamage.ts) — same "geometric fact, computed
// and reported, never silently auto-applied" precedent as this module's own
// opportunityAttackTriggers plumbing one layer up.
export type CostType = 'difficult' | 'impassable' | 'special' | 'pit';
export type Medium = 'ground' | 'water' | 'air' | 'underground';
export type Faction = 'player' | 'ally' | 'enemy' | 'neutral';
export type DiagonalRule = 'flat' | 'alternating_5_10_5';

export interface CellOverride {
  costType: CostType;
  medium: Medium;
  specialCostFt: number | null;
  /** Only meaningful when costType === 'pit' (P3-1); null otherwise. */
  pitDepthFt: number | null;
}

export interface Occupant {
  participantId: string;
  faction: Faction;
  sizeRank: number; // 0=Tiny .. 5=Gargantuan, see SIZE_RANK below
  /** P2-1 (CB-01) — true when this occupant currently has the Incapacitated
   * condition, or a condition whose own text grants it (Paralyzed, Petrified,
   * Stunned, Unconscious). 2024-only exception (see isOccupantPassable);
   * irrelevant, and never read, for a 2014 grid. */
  isIncapacitated: boolean;
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
  /** Wall/locked-door segments (map-cell coordinate space, same as PathStep) — a step whose straight line crosses one of these is blocked, regardless of terrain/occupancy. */
  walls: Segment[];
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
  // 2024: ally (same side), Tiny, Incapacitated (P2-1/CB-01), or the
  // size-difference check above (rulesGlossary.md combat.md lines 59-64).
  return sameSide || occupant.sizeRank === 0 || occupant.isIncapacitated;
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
  from: Point,
  toX: number,
  toY: number,
  baseStepCost: number,
): StepCost {
  if (grid.walls.length > 0 && !hasLineOfSight(from, { x: toX, y: toY }, grid.walls)) {
    return { costFt: 0, passable: false };
  }

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

      const step = computeStepCost(grid, mover, current, n.x, n.y, baseStepCost);
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

// docs/roadmap/dnd-2024-gap-analysis.md P2-3 (CB-08) — Opportunity Attack
// trigger detection. rulesGlossary.md line 1215: "You can make an
// Opportunity Attack when a creature that you can see leaves your reach
// using its action, its Bonus Action, its Reaction, or one of its speeds."
// "Compute-and-suggest" only, same precedent as P2-2/CB-07 and P1-10/Cover
// (this app has no attack resolution pipeline to enforce a forced reaction
// spend against) — this returns WHICH threat sources a move left the reach
// of; the caller (services/encounters.ts's setParticipantPosition) surfaces
// that list, and the DM/player decides whether to actually spend a Reaction
// via the existing applyActionEconomy(spend: 'reaction') path.
//
// Reach is a flat 5 ft for every threat source (rulesGlossary.md "Reach":
// "A creature has a reach of 5 feet unless a rule says otherwise" — this
// app tracks no per-creature/per-weapon reach override, so the stated
// DEFAULT is the correct value here, not a simplification). "Within reach"
// is measured as Chebyshev (grid) distance, matching this module's own
// step-cost model — under the 'flat' diagonal rule a diagonal step costs
// the same as an orthogonal one, i.e. this module already treats
// diagonally-adjacent cells as equally "1 step" away, which is the grid
// convention this reach check mirrors (not true Euclidean geometry, which
// domain/vision.ts's `distance` uses for line-of-sight/vision RANGE checks
// instead — a different, non-grid-snapped question).
export interface ThreatSource {
  participantId: string;
  faction: Faction;
  x: number;
  y: number;
  /** reaction_used === false AND not currently Incapacitated — an
   * Incapacitated creature can't take a Reaction at all (rulesGlossary.md
   * line 1028) and a spent Reaction can't be spent twice; both make this
   * threat source structurally incapable of the Opportunity Attack it would
   * otherwise be reported for, so it's excluded rather than reported
   * as a trigger the DM would then have to notice is illegal anyway. */
  canReact: boolean;
}

function chebyshevDistanceCells(a: PathStep, b: PathStep): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

const DEFAULT_REACH_FT = 5;

/** Threat-source participant ids whose reach this path leaves at some step
 * — i.e. was within reach at step N, no longer within reach at step N+1.
 * Never fires for a threat source on the mover's own side (party/foes split,
 * same as isOccupantPassable's sideOf) or a neutral participant on either
 * side (matches this module's existing "neutral is nonhostile to everyone"
 * reading). At most one trigger per threat source per call, even if the
 * path leaves and re-enters that same threat's reach more than once. */
export function computeOpportunityAttackTriggers(path: PathStep[], moverFaction: Faction, feetPerCell: number, threats: ThreatSource[]): string[] {
  if (path.length < 2 || feetPerCell <= 0) return [];
  const moverSide = sideOf(moverFaction);
  const reachCells = DEFAULT_REACH_FT / feetPerCell;

  const triggered: string[] = [];
  for (const threat of threats) {
    if (!threat.canReact) continue;
    const threatSide = sideOf(threat.faction);
    if (moverSide === 'neutral' || threatSide === 'neutral' || moverSide === threatSide) continue;

    let wasInReach = chebyshevDistanceCells(path[0]!, threat) <= reachCells;
    for (let i = 1; i < path.length; i++) {
      const nowInReach = chebyshevDistanceCells(path[i]!, threat) <= reachCells;
      if (wasInReach && !nowInReach) {
        triggered.push(threat.participantId);
        break;
      }
      wasInReach = nowInReach;
    }
  }
  return triggered;
}

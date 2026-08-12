// Client-side straight-line distance estimate for the live drag-preview
// label — a cheap mirror of services/movement.ts's diagonal-cost formula
// (5-5-5 flat vs 5-10-5 alternating), NOT a re-implementation of its full
// terrain-aware Dijkstra pathfind. Preview-only: the existing server PATCH
// (setParticipantPosition -> computeValidatedMoveCost) remains the sole
// legality/cost authority: this never blocks a move, it only labels one
// while it's being dragged.
//
// Diagonal-step counting for a straight line with no obstacles: the shorter
// of |dx|/|dy| is the number of diagonal steps, the remainder is straight
// steps — matches server/services/movement.ts's dijkstra when it walks a
// straight, unobstructed path (confirmed against movement.test.ts's known
// 5/10/5 sequences in dragPreview.test.ts). Diagonal parity always starts at
// 0 for this single estimate, mirroring dijkstra's own fresh start per path
// search (parity isn't carried across separate move calls server-side
// either).
export type DiagonalRule = 'flat' | 'alternating_5_10_5';

export function estimateDragDistanceFt(
  from: { x: number; y: number },
  to: { x: number; y: number },
  feetPerCell: number,
  diagonalRule: DiagonalRule,
): number {
  const dx = Math.abs(to.x - from.x);
  const dy = Math.abs(to.y - from.y);
  const diagonalSteps = Math.min(dx, dy);
  const straightSteps = Math.max(dx, dy) - diagonalSteps;

  if (diagonalRule === 'flat') {
    return (diagonalSteps + straightSteps) * feetPerCell;
  }

  // Alternates 5, 10, 5, 10... per diagonal step: every other one (the
  // "10 ft" step) doubles the base cost — floor(n/2) of the n diagonal
  // steps are doubled.
  const diagonalFt = feetPerCell * (diagonalSteps + Math.floor(diagonalSteps / 2));
  return diagonalFt + straightSteps * feetPerCell;
}

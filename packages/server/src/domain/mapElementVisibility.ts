// GM-only visibility layer (nav point 2) — server-side mirror of the
// client registry's per-type `blocksVision` rule (packages/web/src/
// encounters/elements/registry.tsx), needed because a hidden wall/door's
// redacted wire stub (services/mapElements.ts's formatMapElementForViewer)
// must tell a player's fog-of-war raycaster whether it blocks vision
// WITHOUT leaking `props` (a door's open/closed/locked state stays hidden;
// only the derived boolean a raycaster actually needs is sent). Keep this
// truth table in sync with the client registry's wall/door `blocksVision`
// entries by inspection — there is no shared module between the two
// packages to enforce it structurally.
export interface BlocksVisionInput {
  type: 'wall' | 'door' | 'light' | 'area' | 'note' | 'image';
  props: Record<string, unknown>;
}

export function computeBlocksVision(el: BlocksVisionInput): boolean {
  switch (el.type) {
    case 'wall':
      return true;
    case 'door': {
      const state = (el.props as { state?: string }).state;
      // A broken door is destroyed — nothing left to block sight through,
      // same as 'open'. Every other state (closed/locked/stuck) is a solid
      // door blocking line of sight.
      return state !== 'open' && state !== 'broken';
    }
    default:
      return false; // light/area/note/image never block vision
  }
}

// Wall movement blocking (services/movement.ts's loadMovementContext) —
// server-side mirror of the client registry's per-type `blocksMovement`
// rule, same "keep in sync by inspection" caveat as computeBlocksVision
// above. Deliberately a DIFFERENT predicate for a door: a closed-but-
// unlocked door blocks LINE OF SIGHT (you can't see through it) but not
// MOVEMENT (a mover can open it and walk through as part of the move) —
// only a door a mover can't just open blocks movement outright: 'locked'
// (no key/no time to pick it) and 'stuck' (won't budge without forcing it)
// both do; 'broken' is a destroyed door, passable exactly like 'open'.
export function computeBlocksMovement(el: BlocksVisionInput): boolean {
  switch (el.type) {
    case 'wall':
      return true;
    case 'door': {
      const state = (el.props as { state?: string }).state;
      return state === 'locked' || state === 'stuck';
    }
    default:
      return false; // light/area/note/image never block movement
  }
}

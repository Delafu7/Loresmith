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
    case 'door':
      return (el.props as { state?: string }).state !== 'open';
    default:
      return false; // light/area/note/image never block vision
  }
}

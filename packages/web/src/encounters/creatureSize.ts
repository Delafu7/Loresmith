// Size category -> grid footprint. See docs/rules/creature-sizes.md for the
// full SRD sourcing (identical in both 2014 and 2024). `monsters.size` is
// free text with no DB/Zod enum (confirmed in that doc), so a homebrew
// creature saved as 'small' or 'Large (Swarm)' must not silently render as
// an unrecognized 0-cell token — normalizeSizeKey always resolves to a
// defined footprint, falling back to Medium (1x1) and flagging the miss via
// its return tuple rather than guessing.

export type SizeCategory = 'Tiny' | 'Small' | 'Medium' | 'Large' | 'Huge' | 'Gargantuan';

// Side length in grid cells (an NxN span from the token's anchor cell), not
// total cell count. Tiny is 1 here too (see docs/rules/creature-sizes.md
// "Tiny creatures sharing a cell") — it renders sub-cell via
// TINY_SHARES_CELL below, not a fractional span.
export const SIZE_FOOTPRINT_CELLS: Record<SizeCategory, number> = {
  Tiny: 1,
  Small: 1,
  Medium: 1,
  Large: 2,
  Huge: 3,
  Gargantuan: 4,
};

export const DEFAULT_SIZE: SizeCategory = 'Medium';

/**
 * Case/whitespace-insensitive match against the six canonical categories;
 * anything else (unrecognized string, empty, undefined) resolves to the
 * Medium default with `recognized: false` so callers can surface a visible
 * "unrecognized size" affordance instead of silently rendering wrong.
 */
export function normalizeSizeKey(raw: string | null | undefined): { key: SizeCategory; recognized: boolean } {
  const trimmed = raw?.trim().toLowerCase();
  const match = (Object.keys(SIZE_FOOTPRINT_CELLS) as SizeCategory[]).find((k) => k.toLowerCase() === trimmed);
  return match ? { key: match, recognized: true } : { key: DEFAULT_SIZE, recognized: false };
}

export function footprintCellsFor(raw: string | null | undefined): number {
  return SIZE_FOOTPRINT_CELLS[normalizeSizeKey(raw).key];
}

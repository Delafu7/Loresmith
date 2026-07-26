// Small shared display helper — mirrors StatBlock.tsx's local (unexported)
// formatCr exactly, duplicated rather than exported across module boundaries
// for a single one-line function.
export function formatCrLabel(cr: number): string {
  if (cr === 0.125) return '1/8';
  if (cr === 0.25) return '1/4';
  if (cr === 0.5) return '1/2';
  return String(cr);
}

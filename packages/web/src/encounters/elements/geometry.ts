// Pixel-space line-segment styling shared by wall/door rendering
// (registry.tsx) — a thin absolutely-positioned, rotated div rather than
// SVG, matching BattleMap.tsx's existing div-based (no canvas/SVG for
// tokens/grid) rendering approach. Full grid<->pixel<->feet conversion
// helpers land as encounters/geometry.ts in Phase 2; this is scoped to just
// what element rendering needs today.
import type { CSSProperties } from 'react';

export function segmentStyle(x1: number, y1: number, x2: number, y2: number, strokeWidthPx: number): CSSProperties {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.hypot(dx, dy);
  const angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
  return {
    position: 'absolute',
    left: x1,
    top: y1 - strokeWidthPx / 2,
    width: length,
    height: strokeWidthPx,
    transform: `rotate(${angleDeg}deg)`,
    transformOrigin: '0 50%',
  };
}

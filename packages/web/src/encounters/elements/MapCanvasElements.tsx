// GM-only visibility layer — the array this component receives is already
// server-filtered for a non-DM viewer (see server's formatMapElementForViewer):
// a hidden note/area/image is simply absent, and a hidden wall/door/light
// arrives as a `redacted: true` stub (geometry only, no label/props) needed
// by vision/segments.ts's raycasting but never meant to be rendered. So the
// only client-side work left is (1) never render a redacted stub, and (2)
// keep the DM-only dimming ("clear marker" requirement) for the DM's own
// always-full payload, driven by `el.visibility !== 'revealed_to_players'`.
import type { MouseEvent } from 'react';
import type { MapElementOrRedacted } from '../../lib/types';
import { renderMapElement, type ElementRenderCtx } from './registry';

export function MapCanvasElements({
  elements,
  isDm,
  cellSizePx,
  selectedElementId,
  onSelect,
  resolveAssetUrl,
}: {
  elements: MapElementOrRedacted[];
  isDm: boolean;
  cellSizePx: number;
  selectedElementId: string | null;
  /** GM-only visibility layer — the click event is forwarded so the caller
   * can detect a shift-click for multi-select. */
  onSelect: (id: string, e: MouseEvent) => void;
  resolveAssetUrl: (assetId: string) => string | undefined;
}) {
  const visible = elements
    .filter((el): el is Exclude<MapElementOrRedacted, { redacted: true }> => !('redacted' in el && el.redacted))
    .sort((a, b) => a.zIndex - b.zIndex);

  return (
    <>
      {visible.map((el) => {
        const ctx: ElementRenderCtx = {
          cellSizePx,
          isSelected: el.id === selectedElementId,
          onSelect: (e) => onSelect(el.id, e),
          resolveAssetUrl,
        };
        return (
          <div key={el.id} className={isDm && el.visibility !== 'revealed_to_players' ? 'opacity-60' : ''}>
            {renderMapElement(el, ctx)}
          </div>
        );
      })}
    </>
  );
}

// Generic over ELEMENT_REGISTRY (renderMapElement) — no type-specific branch
// here. The one non-generic rule is the note-visibility one, and it's a
// blanket type check, not per-type render logic: 'note' elements are never
// rendered to a non-DM viewer regardless of visibleToPlayers, matching the
// server's "wire carries everything, client redacts notes" contract (see
// lib/socketTypes.ts's MapElementsChangedEvent doc comment). Every other
// type's visibleToPlayers === false element is likewise skipped for a
// non-DM viewer — the DM still sees it (dimmed) so they know it's hidden.
import type { MapElement } from '../../lib/types';
import { renderMapElement, type ElementRenderCtx } from './registry';

export function MapCanvasElements({
  elements,
  isDm,
  cellSizePx,
  selectedElementId,
  onSelect,
  resolveAssetUrl,
}: {
  elements: MapElement[];
  isDm: boolean;
  cellSizePx: number;
  selectedElementId: string | null;
  onSelect: (id: string) => void;
  resolveAssetUrl: (assetId: string) => string | undefined;
}) {
  const visible = elements
    .filter((el) => (el.type === 'note' ? isDm : isDm || el.visibleToPlayers))
    .sort((a, b) => a.zIndex - b.zIndex);

  return (
    <>
      {visible.map((el) => {
        const ctx: ElementRenderCtx = {
          cellSizePx,
          isSelected: el.id === selectedElementId,
          onSelect: () => onSelect(el.id),
          resolveAssetUrl,
        };
        return (
          <div key={el.id} className={!el.visibleToPlayers && isDm ? 'opacity-60' : ''}>
            {renderMapElement(el, ctx)}
          </div>
        );
      })}
    </>
  );
}

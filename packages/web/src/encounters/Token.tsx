// One participant's marker on the battle map (Phase 3.3). Dragging is native
// pointer events + local component state — the parent (BattleMap) is only
// told about the FINAL cell once, on pointer-up, never on every move tick
// (see BattleMap.tsx's header comment for why: no write/broadcast storm).
//
// Scope boundary: SnapshotParticipant (lib/types.ts) carries no portrait/art
// URL today (that data — characters.portrait_asset_id / monsters.art_asset_id
// — never flows into the combat snapshot), so this always renders Portrait's
// placeholder-initial fallback rather than a real image. Wiring a real image
// through would mean widening the FULL_STATE_SYNC/snapshot payload server-side,
// which is out of scope here — named explicitly rather than guessing at a URL
// that isn't in the payload.

import { useRef, useState } from 'react';
import { Portrait, type PortraitSize } from '../components/Portrait';
import type { SnapshotParticipant } from '../lib/types';

function portraitSizeFor(cellSizePx: number): PortraitSize {
  if (cellSizePx <= 36) return 'sm';
  if (cellSizePx <= 56) return 'md';
  if (cellSizePx <= 90) return 'lg';
  return 'xl';
}

// Mirrors Portrait.tsx's SIZE_CLASSES pixel dimensions exactly, so the ring
// wrapper below sizes to precisely what Portrait renders instead of an
// arbitrary cellSizePx fraction that could crop or float inside it.
const PORTRAIT_SIZE_PX: Record<PortraitSize, number> = { sm: 40, md: 64, lg: 96, xl: 144 };

export function Token({
  participant,
  cellSizePx,
  gridColumns,
  gridRows,
  isActive,
  isDraggable,
  onMove,
}: {
  participant: SnapshotParticipant;
  cellSizePx: number;
  gridColumns: number;
  gridRows: number;
  isActive: boolean;
  /** Gates ALL pointer-event wiring, not just a disabled-looking affordance — a
   * player's token has no handlers attached at all. */
  isDraggable: boolean;
  /** Called once, on drop, with the final snapped cell indices. */
  onMove: (x: number, y: number) => void;
}) {
  const posX = participant.posX ?? 0;
  const posY = participant.posY ?? 0;

  // Local-only during a drag: the network write/broadcast happens once, on
  // pointer-up, from BattleMap — not here.
  const [dragOffset, setDragOffset] = useState<{ dx: number; dy: number } | null>(null);
  const dragStart = useRef<{ pointerX: number; pointerY: number } | null>(null);

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragStart.current = { pointerX: e.clientX, pointerY: e.clientY };
    setDragOffset({ dx: 0, dy: 0 });
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragStart.current) return;
    setDragOffset({ dx: e.clientX - dragStart.current.pointerX, dy: e.clientY - dragStart.current.pointerY });
  }

  function handlePointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragStart.current) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    const { dx, dy } = dragOffset ?? { dx: 0, dy: 0 };
    dragStart.current = null;
    setDragOffset(null);

    // Snap to nearest cell, clamped to the configured grid bounds.
    const snappedX = Math.min(Math.max(Math.round(posX + dx / cellSizePx), 0), gridColumns - 1);
    const snappedY = Math.min(Math.max(Math.round(posY + dy / cellSizePx), 0), gridRows - 1);
    if (snappedX !== posX || snappedY !== posY) onMove(snappedX, snappedY);
  }

  const left = posX * cellSizePx + (dragOffset?.dx ?? 0);
  const top = posY * cellSizePx + (dragOffset?.dy ?? 0);
  const size = portraitSizeFor(cellSizePx);
  const portraitPx = PORTRAIT_SIZE_PX[size];

  return (
    <div
      className={`absolute flex items-center justify-center ${isDraggable ? 'cursor-grab active:cursor-grabbing touch-none' : ''}`}
      style={{ left, top, width: cellSizePx, height: cellSizePx, zIndex: dragOffset ? 30 : 10 }}
      onPointerDown={isDraggable ? handlePointerDown : undefined}
      onPointerMove={isDraggable ? handlePointerMove : undefined}
      onPointerUp={isDraggable ? handlePointerUp : undefined}
      title={participant.name}
    >
      <div
        className={`rounded-full ${isActive ? 'ring-2 ring-amber-500 ring-offset-1 ring-offset-stone-950' : ''}`}
        style={{ width: portraitPx, height: portraitPx }}
      >
        <Portrait fileUrl={null} alt={participant.name} shape="circle" size={size} placeholderLabel={participant.name} />
      </div>
    </div>
  );
}

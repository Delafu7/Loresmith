// One participant's marker on the battle map (Phase 3.3; extended for board
// readability in REFACTOR-PLAN.md §3). Dragging is native pointer events +
// local component state — the parent (BattleMap) is only told about the
// FINAL cell once, on pointer-up, never on every move tick (see
// BattleMap.tsx's header comment for why: no write/broadcast storm).
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
import type { ParticipantHp, SnapshotParticipant } from '../lib/types';
import { isExactHp } from '../lib/types';
import { footprintCellsFor } from './creatureSize';

function portraitSizeFor(spanPx: number): PortraitSize {
  if (spanPx <= 36) return 'sm';
  if (spanPx <= 56) return 'md';
  if (spanPx <= 90) return 'lg';
  return 'xl';
}

// Mirrors Portrait.tsx's SIZE_CLASSES pixel dimensions exactly, so the ring
// wrapper below sizes to precisely what Portrait renders instead of an
// arbitrary cellSizePx fraction that could crop or float inside it.
const PORTRAIT_SIZE_PX: Record<PortraitSize, number> = { sm: 40, md: 64, lg: 96, xl: 144 };

// REFACTOR-PLAN.md §3: "a colored border for faction." Player/ally read as
// "friendly" (cool colors), enemy/neutral as "not" — matching this app's
// existing verdigris-for-good / blood-for-bad palette conventions elsewhere.
const FACTION_BORDER: Record<SnapshotParticipant['faction'], string> = {
  player: 'border-sky-500',
  ally: 'border-emerald-500',
  enemy: 'border-red-600',
  neutral: 'border-stone-500',
};

const HP_BAR_COLOR: Record<string, string> = {
  Healthy: 'bg-emerald-600',
  Injured: 'bg-yellow-600',
  Bloodied: 'bg-orange-600',
  Critical: 'bg-red-600',
  Down: 'bg-stone-600',
};

function bandForExact(current: number, max: number): keyof typeof HP_BAR_COLOR {
  if (max <= 0 || current <= 0) return 'Down';
  const pct = current / max;
  if (pct > 0.75) return 'Healthy';
  if (pct > 0.5) return 'Injured';
  if (pct > 0.25) return 'Bloodied';
  return 'Critical';
}

function TokenHpIndicator({ hp }: { hp: ParticipantHp }) {
  if (isExactHp(hp)) {
    const pct = hp.hpMax > 0 ? Math.max(0, Math.min(100, (hp.hpCurrent / hp.hpMax) * 100)) : 0;
    const band = bandForExact(hp.hpCurrent, hp.hpMax);
    return (
      <div
        className="absolute -bottom-1 left-1/2 -translate-x-1/2 h-1.5 w-[85%] rounded-full bg-stone-900 overflow-hidden"
        role="progressbar"
        aria-label="HP"
        aria-valuenow={hp.hpCurrent}
        aria-valuemin={0}
        aria-valuemax={hp.hpMax}
      >
        <div className={`h-full ${HP_BAR_COLOR[band]}`} style={{ width: `${pct}%` }} />
      </div>
    );
  }
  return (
    <span
      className={`absolute -bottom-1 left-1/2 -translate-x-1/2 h-2 w-2 rounded-full ${HP_BAR_COLOR[hp.band]} ring-1 ring-stone-950`}
      title={hp.band}
      aria-label={`HP band: ${hp.band}`}
    />
  );
}

export function Token({
  participant,
  cellSizePx,
  gridColumns,
  gridRows,
  isActive,
  isDraggable,
  isSelected,
  onMove,
  onSelect,
}: {
  participant: SnapshotParticipant;
  cellSizePx: number;
  gridColumns: number;
  gridRows: number;
  isActive: boolean;
  /** Gates ALL pointer-event wiring, not just a disabled-looking affordance — a
   * player's token has no handlers attached at all. */
  isDraggable: boolean;
  /** REFACTOR-PLAN.md §3: two-way sync with the side roster — highlighted
   * when the corresponding roster row is hovered/selected, and vice versa. */
  isSelected?: boolean;
  /** Called once, on drop, with the final snapped cell indices. */
  onMove: (x: number, y: number) => void;
  onSelect?: () => void;
}) {
  const posX = participant.posX ?? 0;
  const posY = participant.posY ?? 0;
  const footprint = footprintCellsFor(participant.size);
  const spanPx = cellSizePx * footprint;

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

    // Snap to nearest cell, clamped so a footprint > 1 cell never hangs off
    // the configured grid bounds.
    const snappedX = Math.min(Math.max(Math.round(posX + dx / cellSizePx), 0), Math.max(0, gridColumns - footprint));
    const snappedY = Math.min(Math.max(Math.round(posY + dy / cellSizePx), 0), Math.max(0, gridRows - footprint));
    if (snappedX !== posX || snappedY !== posY) onMove(snappedX, snappedY);
  }

  const left = posX * cellSizePx + (dragOffset?.dx ?? 0);
  const top = posY * cellSizePx + (dragOffset?.dy ?? 0);
  const size = portraitSizeFor(spanPx);
  const portraitPx = PORTRAIT_SIZE_PX[size];

  return (
    <div
      className={`absolute flex items-center justify-center ${isDraggable ? 'cursor-grab active:cursor-grabbing touch-none' : 'cursor-pointer'}`}
      style={{ left, top, width: spanPx, height: spanPx, zIndex: dragOffset ? 30 : isSelected ? 20 : 10 }}
      onPointerDown={isDraggable ? handlePointerDown : undefined}
      onPointerMove={isDraggable ? handlePointerMove : undefined}
      onPointerUp={isDraggable ? handlePointerUp : undefined}
      onClick={onSelect}
      title={`${participant.name} (${String.fromCharCode(65 + posX)}${posY + 1})`}
    >
      {participant.effects.length > 0 && (
        <div className="absolute -top-2 left-1/2 -translate-x-1/2 flex gap-0.5 z-10">
          {participant.effects.slice(0, 4).map((e) => (
            <span
              key={e.effectId}
              title={e.name}
              aria-label={e.name}
              className="h-2 w-2 rounded-full bg-violet-500 ring-1 ring-stone-950"
            />
          ))}
          {participant.effects.length > 4 && (
            <span className="text-[8px] leading-none text-violet-300 self-center">+{participant.effects.length - 4}</span>
          )}
        </div>
      )}
      <div
        className={`relative rounded-full border-2 ${FACTION_BORDER[participant.faction]} ${
          isActive ? 'ring-2 ring-amber-500 ring-offset-1 ring-offset-stone-950' : ''
        } ${isSelected ? 'outline outline-2 outline-offset-2 outline-amber-300' : ''}`}
        style={{ width: portraitPx, height: portraitPx }}
      >
        <Portrait fileUrl={null} alt={participant.name} shape="circle" size={size} placeholderLabel={participant.name} />
        <TokenHpIndicator hp={participant.hp} />
      </div>
    </div>
  );
}

// One participant's marker on the battle map (Phase 3.3; extended for board
// readability in REFACTOR-PLAN.md §3). Dragging is native pointer events +
// local component state — the parent (BattleMap) is only told about the
// FINAL cell once, on pointer-up, never on every move tick (see
// BattleMap.tsx's header comment for why: no write/broadcast storm).
//
// Token art: participant.imageUrl is resolved server-side (getEncounterCombatSnapshot
// in services/encounters.ts) from the character's portrait or the monster's
// homebrew art upload / catalog image_url — Portrait already falls back to an
// initials/silhouette placeholder whenever it's null, so a missing image never
// renders a gap or a broken-image icon.

import { memo, useRef, useState } from 'react';
import { Portrait, type PortraitSize } from '../components/Portrait';
import type { ParticipantHp, SnapshotParticipant } from '../lib/types';
import { footprintCellsFor } from './creatureSize';
import { useLocale } from '../i18n/LocaleContext';

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
  const { t } = useLocale();
  const pct = hp.hpMax > 0 ? Math.max(0, Math.min(100, (hp.hpCurrent / hp.hpMax) * 100)) : 0;
  const band = bandForExact(hp.hpCurrent, hp.hpMax);
  return (
    <div
      className="absolute -bottom-1 left-1/2 -translate-x-1/2 h-1.5 w-[85%] rounded-full bg-stone-900 overflow-hidden"
      role="progressbar"
      aria-label={t('encounters.battleMap.hp')}
      aria-valuenow={hp.hpCurrent}
      aria-valuemin={0}
      aria-valuemax={hp.hpMax}
    >
      <div className={`h-full ${HP_BAR_COLOR[band]}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

// Phase 3 mobile pass: "if token labels/HP/condition icons can't stay
// legible at phone scale, define a simplified token rendering below a zoom
// threshold rather than shrinking everything proportionally." Below this
// on-screen size, a full Portrait + HP bar + condition dots stack becomes
// illegible noise — swap to a flat colored dot with a 1-2 letter initial.
const SIMPLIFIED_BELOW_PX = 30;

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

const FACTION_DOT: Record<SnapshotParticipant['faction'], string> = {
  player: 'bg-sky-600',
  ally: 'bg-emerald-600',
  enemy: 'bg-red-700',
  neutral: 'bg-stone-600',
};

export interface TokenProps {
  participant: SnapshotParticipant;
  cellSizePx: number;
  gridColumns: number;
  gridRows: number;
  /** Current map zoom — used only to decide the legibility threshold below
   * (the parent scales the whole grid via CSS transform, so this doesn't
   * affect layout math here, just which rendering this token picks). */
  zoom?: number;
  isActive: boolean;
  /** Gates ALL pointer-event wiring, not just a disabled-looking affordance — a
   * player's token has no handlers attached at all. */
  isDraggable: boolean;
  /** REFACTOR-PLAN.md §3: two-way sync with the side roster — highlighted
   * when the corresponding roster row is hovered/selected, and vice versa. */
  isSelected?: boolean;
  /** Called once, on drop, with the final snapped cell indices. */
  onMove: (x: number, y: number) => void;
  /** Single click/tap — selects the token for movement only (drag targeting,
   * reachable-cell highlighting). Deliberately does NOT open the stats sheet
   * — a DM repositioning several tokens in a row would otherwise get a stats
   * panel popping open on every single click. See onOpenSheet below. */
  onSelect?: () => void;
  /** Double click/tap — opens the participant's full stats sheet. Kept
   * separate from onSelect (both fire on a real double-click; harmless,
   * since re-selecting an already-selected token is a no-op toggle). */
  onOpenSheet?: () => void;
}

// Performance (map-first encounter system: the map is now the permanent
// fullscreen focus, so an unnecessary re-render of every OTHER token on any
// single HP/position/effect change matters more than it used to). onMove/
// onSelect are deliberately excluded from the comparison — BattleMap.tsx
// creates a fresh closure for each token on every one of ITS OWN renders,
// but each closure only ever captures that same token's own participantId,
// so a "stale" closure from a skipped re-render is never actually stale in
// a way that matters. `participant` is compared by reference, not deep
// equality: useEncounterLive.ts's patch functions already preserve the
// object reference for every participant a given socket event didn't touch
// (`prev.participants.map((p) => p.participantId === id ? {...} : p)`), so
// reference equality alone already means "genuinely unchanged," with no need
// to recompute or deep-compare anything here.
function tokenPropsAreEqual(prev: TokenProps, next: TokenProps): boolean {
  return (
    prev.participant === next.participant &&
    prev.cellSizePx === next.cellSizePx &&
    prev.gridColumns === next.gridColumns &&
    prev.gridRows === next.gridRows &&
    prev.zoom === next.zoom &&
    prev.isActive === next.isActive &&
    prev.isDraggable === next.isDraggable &&
    prev.isSelected === next.isSelected
  );
}

function TokenComponent({
  participant,
  cellSizePx,
  gridColumns,
  gridRows,
  zoom = 1,
  isActive,
  isDraggable,
  isSelected,
  onMove,
  onSelect,
  onOpenSheet,
}: TokenProps) {
  const posX = participant.posX ?? 0;
  const posY = participant.posY ?? 0;
  const footprint = footprintCellsFor(participant.size);
  const spanPx = cellSizePx * footprint;
  const simplified = spanPx * zoom < SIMPLIFIED_BELOW_PX;

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
      onDoubleClick={onOpenSheet}
      title={`${participant.name} (${String.fromCharCode(65 + posX)}${posY + 1})`}
    >
      {simplified ? (
        // Below SIMPLIFIED_BELOW_PX on screen, a full portrait + HP bar +
        // condition dots is illegible noise, not detail — a flat faction-
        // colored dot with initials reads better at a glance than shrinking
        // every layer proportionally (docs/design-tokens.md mobile pass).
        <div
          className={`flex items-center justify-center rounded-full text-white font-semibold ${FACTION_DOT[participant.faction]} ${
            isActive ? 'ring-2 ring-amber-500 ring-offset-1 ring-offset-stone-950' : ''
          } ${isSelected ? 'outline outline-2 outline-offset-1 outline-amber-300' : ''}`}
          style={{ width: spanPx, height: spanPx, fontSize: Math.max(8, spanPx * 0.4) }}
        >
          {initials(participant.name)}
        </div>
      ) : (
        <>
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
            <Portrait fileUrl={participant.imageUrl} alt={participant.name} shape="circle" size={size} placeholderLabel={participant.name} />
            <TokenHpIndicator hp={participant.hp} />
          </div>
        </>
      )}
    </div>
  );
}

export const Token = memo(TokenComponent, tokenPropsAreEqual);

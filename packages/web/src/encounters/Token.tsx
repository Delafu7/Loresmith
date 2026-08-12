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
import { CONTROL_BADGE_DOT_COLOR, controlBadgeLabel, type ControlBadgeKind } from './controlBadge';
import { useLocale } from '../i18n/LocaleContext';
import { HP_BAND_COLOR, bandFor } from '../components/HPBar';
import { snapToCell } from './geometry';
import { estimateDragDistanceFt, type DiagonalRule } from './dragPreview';

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

// Phase 2 "restore hp_visibility + banding" — a token whose participant hp
// is 'hidden' shows no bar at all (nothing rendered); 'banded' shows a
// full-width bar in the band's color rather than a percentage-filled one,
// since a width proportional to an unknown exact value would imply false
// precision. Reuses HPBar.tsx's band→color mapping/threshold function
// (HP_BAND_COLOR/bandFor) rather than a third hand-rolled copy.
function TokenHpIndicator({ hp }: { hp: ParticipantHp }) {
  const { t } = useLocale();
  if (hp.hpVisibility === 'hidden' && !('hpCurrent' in hp)) return null;

  if (!('hpCurrent' in hp)) {
    // hp.hpVisibility === 'banded' here (the only other non-numeric case).
    return (
      <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 h-1.5 w-[85%] rounded-full bg-stone-900 overflow-hidden" aria-label={t('encounters.battleMap.hp')}>
        <div className={`h-full w-full ${HP_BAND_COLOR[hp.band]}`} />
      </div>
    );
  }

  const pct = hp.hpMax > 0 ? Math.max(0, Math.min(100, (hp.hpCurrent / hp.hpMax) * 100)) : 0;
  const band = bandFor(hp.hpCurrent, hp.hpMax);
  return (
    <div
      className="absolute -bottom-1 left-1/2 -translate-x-1/2 h-1.5 w-[85%] rounded-full bg-stone-900 overflow-hidden"
      role="progressbar"
      aria-label={t('encounters.battleMap.hp')}
      aria-valuenow={hp.hpCurrent}
      aria-valuemin={0}
      aria-valuemax={hp.hpMax}
    >
      <div className={`h-full ${HP_BAND_COLOR[band]}`} style={{ width: `${pct}%` }} />
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
  /** Phase 2 multi-select (shift-click) — a distinct outline from isSelected
   * so "the one token whose reachable-cells are shown" and "every token that
   * will move together" read as different states at a glance. */
  isMultiSelected?: boolean;
  /** Iteration 2 "Character ownership vs. control" — a small corner dot
   * (controlBadge.ts), not a token recolor, distinguishing "mine,"
   * "temporarily mine," "another player's," and "GM-run." Null/undefined
   * (monster instances, DM-run NPCs) renders no dot at all. */
  controlBadge?: ControlBadgeKind | null;
  /** Movement-math ratio (MapConfig.feetPerCell) + the campaign's diagonal
   * rule — both needed purely to compute the live drag-distance label below,
   * never to gate the drag itself (see dragPreview.ts's header comment). */
  feetPerCell: number;
  diagonalRule: DiagonalRule;
  /** Phase 2 grid-snap toggle — scopes to drag-PREVIEW smoothness only; the
   * final dropped cell (onMove below) is always whole-cell regardless. */
  snapToGrid: boolean;
  /** Called once, on drop, with the final snapped cell indices. */
  onMove: (x: number, y: number) => void;
  /** Single click/tap — selects the token for movement only (drag targeting,
   * reachable-cell highlighting), or (shift-held) toggles multi-select
   * membership for group-move — see BattleMap.tsx's selectParticipant.
   * Deliberately does NOT open the stats sheet — a DM repositioning several
   * tokens in a row would otherwise get a stats panel popping open on every
   * single click. See onOpenSheet below. */
  onSelect?: (e: React.MouseEvent) => void;
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
    prev.isSelected === next.isSelected &&
    prev.isMultiSelected === next.isMultiSelected &&
    prev.controlBadge === next.controlBadge &&
    prev.feetPerCell === next.feetPerCell &&
    prev.diagonalRule === next.diagonalRule &&
    prev.snapToGrid === next.snapToGrid
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
  isMultiSelected,
  controlBadge = null,
  feetPerCell,
  diagonalRule,
  snapToGrid,
  onMove,
  onSelect,
  onOpenSheet,
}: TokenProps) {
  const { t } = useLocale();
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

  // Snap a raw pixel delta to the nearest cell, clamped so a footprint > 1
  // cell never hangs off the configured grid bounds — shared by the drop
  // handler (always snapped) and the live preview (only when snapToGrid).
  function snappedTargetCell(dx: number, dy: number): { x: number; y: number } {
    return {
      x: Math.min(Math.max(Math.round(posX + dx / cellSizePx), 0), Math.max(0, gridColumns - footprint)),
      y: Math.min(Math.max(Math.round(posY + dy / cellSizePx), 0), Math.max(0, gridRows - footprint)),
    };
  }

  function handlePointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragStart.current) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    const { dx, dy } = dragOffset ?? { dx: 0, dy: 0 };
    dragStart.current = null;
    setDragOffset(null);

    const { x: snappedX, y: snappedY } = snappedTargetCell(dx, dy);
    if (snappedX !== posX || snappedY !== posY) onMove(snappedX, snappedY);
  }

  const size = portraitSizeFor(spanPx);
  const portraitPx = PORTRAIT_SIZE_PX[size];

  // Live drag-preview: snapToGrid quantizes the VISUAL position to whole
  // cells while dragging (dragPreview.ts's caller-facing contract — the
  // final drop below is always whole-cell regardless of this toggle); off,
  // the token continues to follow the pointer continuously as before. Also
  // drives the live distance label — preview-only, never a legality check
  // (see dragPreview.ts's header comment; the server PATCH re-validates
  // everything on drop).
  let left = posX * cellSizePx;
  let top = posY * cellSizePx;
  let dragPreview: { distanceFt: number; remainingFt: number } | null = null;
  if (dragOffset) {
    if (snapToGrid) {
      const target = snappedTargetCell(dragOffset.dx, dragOffset.dy);
      left = target.x * cellSizePx;
      top = target.y * cellSizePx;
      dragPreview = {
        distanceFt: estimateDragDistanceFt({ x: posX, y: posY }, target, feetPerCell, diagonalRule),
        remainingFt: Math.max(0, (participant.speedFt ?? 0) * (participant.dashUsed ? 2 : 1) - participant.movementUsedFt),
      };
    } else {
      left += dragOffset.dx;
      top += dragOffset.dy;
      const target = { x: snapToCell(posX * cellSizePx + dragOffset.dx, cellSizePx), y: snapToCell(posY * cellSizePx + dragOffset.dy, cellSizePx) };
      dragPreview = {
        distanceFt: estimateDragDistanceFt({ x: posX, y: posY }, target, feetPerCell, diagonalRule),
        remainingFt: Math.max(0, (participant.speedFt ?? 0) * (participant.dashUsed ? 2 : 1) - participant.movementUsedFt),
      };
    }
  }

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
      {dragPreview && (
        <div
          className={`absolute -top-6 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[10px] font-medium ${
            dragPreview.distanceFt > dragPreview.remainingFt ? 'bg-red-950/90 text-red-300' : 'bg-stone-950/90 text-stone-200'
          }`}
        >
          {Math.round(dragPreview.distanceFt)} ft
        </div>
      )}
      {simplified ? (
        // Below SIMPLIFIED_BELOW_PX on screen, a full portrait + HP bar +
        // condition dots is illegible noise, not detail — a flat faction-
        // colored dot with initials reads better at a glance than shrinking
        // every layer proportionally (docs/design-tokens.md mobile pass).
        <div
          className={`relative flex items-center justify-center rounded-full text-white font-semibold ${FACTION_DOT[participant.faction]} ${
            isActive ? 'ring-2 ring-amber-500 ring-offset-1 ring-offset-stone-950' : ''
          } ${isSelected ? 'outline outline-2 outline-offset-1 outline-amber-300' : ''} ${
            isMultiSelected ? 'outline outline-2 outline-offset-1 outline-sky-400' : ''
          }`}
          style={{ width: spanPx, height: spanPx, fontSize: Math.max(8, spanPx * 0.4) }}
        >
          {initials(participant.name)}
          {controlBadge && (
            <span
              title={controlBadgeLabel(t, controlBadge)}
              aria-label={controlBadgeLabel(t, controlBadge)}
              className={`absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full ring-1 ring-stone-950 ${CONTROL_BADGE_DOT_COLOR[controlBadge]}`}
            />
          )}
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
            } ${isSelected ? 'outline outline-2 outline-offset-2 outline-amber-300' : ''} ${
              isMultiSelected ? 'outline outline-2 outline-offset-2 outline-sky-400' : ''
            }`}
            style={{ width: portraitPx, height: portraitPx }}
          >
            <Portrait fileUrl={participant.imageUrl} alt={participant.name} shape="circle" size={size} placeholderLabel={participant.name} />
            <TokenHpIndicator hp={participant.hp} />
            {controlBadge && (
              <span
                title={controlBadgeLabel(t, controlBadge)}
                aria-label={controlBadgeLabel(t, controlBadge)}
                className={`absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full ring-1 ring-stone-950 z-10 ${CONTROL_BADGE_DOT_COLOR[controlBadge]}`}
              />
            )}
          </div>
        </>
      )}
    </div>
  );
}

export const Token = memo(TokenComponent, tokenPropsAreEqual);

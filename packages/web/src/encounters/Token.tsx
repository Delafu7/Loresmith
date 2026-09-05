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
import { FACTION_STYLES } from './factionStyle';
import { EffectDots } from './EffectDots';
import { useLocale } from '../i18n/LocaleContext';
import { HP_BAND_COLOR, bandFor } from '../components/HPBar';
import { snapToCell, screenDeltaToWorld } from './geometry';
import { segmentStyle } from './elements/geometry';
import { estimateDragDistanceFt, type DiagonalRule } from './dragPreview';

const PATH_STROKE_WIDTH_PX = 3;

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
    // Primary button (or a touch contact) only — a middle-click or a
    // space-held click must fall through to BattleMap's own pan/pinch
    // handler untouched, not get hijacked into a token drag. stopPropagation
    // is the other half of that contract: a drag we DO start here must not
    // also register as a map pan-start (BattleMap's handler runs on bubble).
    // Stopped unconditionally, even when this token isn't draggable (wrong
    // owner/turn) — otherwise a click-drag on a token you can't move falls
    // straight through to BattleMap's leftDragCandidate/pan promotion,
    // silently panning the whole viewport instead of doing nothing. That
    // read as "the token/image jumped somewhere else" (the camera moved,
    // not the token) — a real bug report, not a permissions question.
    if (e.button !== 0) return;
    e.stopPropagation();
    if (!isDraggable) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragStart.current = { pointerX: e.clientX, pointerY: e.clientY };
    setDragOffset({ dx: 0, dy: 0 });
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragStart.current) return;
    // Screen-space pointer movement -> world-space offset: the parent's CSS
    // `scale(zoom)` transform means one screen pixel of pointer movement is
    // only 1/zoom world pixels of actual map movement — omitting this
    // division (the pre-existing bug) desynced the token from the cursor at
    // any zoom other than 100%.
    const { dx, dy } = screenDeltaToWorld(e.clientX - dragStart.current.pointerX, e.clientY - dragStart.current.pointerY, zoom);
    setDragOffset({ dx, dy });
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
    e.stopPropagation();
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
    const remainingFt = Math.max(0, (participant.speedFt ?? 0) * (participant.dashUsed ? 2 : 1) - participant.movementUsedFt);
    if (snapToGrid) {
      const target = snappedTargetCell(dragOffset.dx, dragOffset.dy);
      left = target.x * cellSizePx;
      top = target.y * cellSizePx;
      dragPreview = { distanceFt: estimateDragDistanceFt({ x: posX, y: posY }, target, feetPerCell, diagonalRule), remainingFt };
    } else {
      left += dragOffset.dx;
      top += dragOffset.dy;
      const target = { x: snapToCell(posX * cellSizePx + dragOffset.dx, cellSizePx), y: snapToCell(posY * cellSizePx + dragOffset.dy, cellSizePx) };
      dragPreview = { distanceFt: estimateDragDistanceFt({ x: posX, y: posY }, target, feetPerCell, diagonalRule), remainingFt };
    }
  }

  // Live path line (token-local coordinates — Token's own root div is
  // `position: absolute`, establishing the positioning context segmentStyle
  // needs, so no separate parent-relative math is required). Split into an
  // in-budget segment and a distinctly-styled over-budget remainder at the
  // straight-line point where cumulative distance would exceed
  // dragPreview.remainingFt — a linear interpolation along the pixel line,
  // not a re-derivation of the alternating 5-10-5 diagonal cost curve
  // (overkill for a preview-only indicator per dragPreview.ts's own
  // contract). Endpoint 2 always tracks the CURRENT visual left/top (so it
  // matches whichever of the snap/no-snap branches above ran), not a fixed
  // cell — continuous in free-drag mode, stepped in snap mode.
  let dragPath: { x1: number; y1: number; splitX: number; splitY: number; x2: number; y2: number; overBudget: boolean } | null = null;
  if (dragOffset && dragPreview) {
    const originX = posX * cellSizePx + spanPx / 2 - left;
    const originY = posY * cellSizePx + spanPx / 2 - top;
    const endX = spanPx / 2;
    const endY = spanPx / 2;
    const overBudget = dragPreview.distanceFt > dragPreview.remainingFt;
    const t = overBudget && dragPreview.distanceFt > 0 ? Math.max(0, Math.min(1, dragPreview.remainingFt / dragPreview.distanceFt)) : 1;
    dragPath = {
      x1: originX,
      y1: originY,
      splitX: originX + (endX - originX) * t,
      splitY: originY + (endY - originY) * t,
      x2: endX,
      y2: endY,
      overBudget,
    };
  }

  return (
    <div
      className={`absolute flex items-center justify-center ${isDraggable ? 'cursor-grab active:cursor-grabbing touch-none' : 'cursor-pointer'}`}
      style={{ left, top, width: spanPx, height: spanPx, zIndex: dragOffset ? 30 : isSelected ? 20 : 10 }}
      onPointerDown={handlePointerDown}
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
      {dragPath && (
        <>
          <div style={segmentStyle(dragPath.x1, dragPath.y1, dragPath.splitX, dragPath.splitY, PATH_STROKE_WIDTH_PX)} className="pointer-events-none rounded-full bg-amber-400/80" />
          {dragPath.overBudget && (
            <div
              style={segmentStyle(dragPath.splitX, dragPath.splitY, dragPath.x2, dragPath.y2, PATH_STROKE_WIDTH_PX)}
              className="pointer-events-none rounded-full bg-red-500/80"
            />
          )}
        </>
      )}
      {simplified ? (
        // Below SIMPLIFIED_BELOW_PX on screen, a full portrait + HP bar +
        // condition dots is illegible noise, not detail — a flat faction-
        // colored dot with initials reads better at a glance than shrinking
        // every layer proportionally (docs/design-tokens.md mobile pass).
        <div
          className={`relative flex items-center justify-center rounded-full text-white font-semibold ${FACTION_STYLES[participant.faction].bg} ${
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
            <div className="absolute -top-2 left-1/2 -translate-x-1/2 z-10">
              <EffectDots effects={participant.effects} />
            </div>
          )}
          <div
            className={`relative shrink-0 rounded-full border-2 ${FACTION_STYLES[participant.faction].border} ${
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

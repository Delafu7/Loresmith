// Battle map (Phase 3.3) — a CSS-grid + absolutely-positioned-divs surface,
// no canvas/SVG/drag library (none exists in this app; the design brief is
// explicit on this point). Dragging is native pointer events, entirely local
// to Token.tsx during the drag — only the FINAL dropped cell is persisted via
// PATCH .../position and broadcast as TOKEN_MOVED. Firing that mutation on
// every pointermove tick would be a write/broadcast storm; this component
// (and Token.tsx) are built specifically to avoid that.
//
// REFACTOR-PLAN.md §3 extends this with: coordinate labels, a free (not
// preset-only) cell size, a roster side panel two-way synced with the map
// (hover/select), and zoom + center-on-active. REFACTOR-PLAN.md §4 adds
// server-validated movement cost: selecting a participant highlights the
// server-computed reachable set (never a client-side re-derivation of the
// cost math — see docs/rules/movement.md), and a DM "paint terrain" tool
// for authoring map_cell_overrides. The DM can always move any token,
// unconditionally; a player may now also drag/tap-move their OWN character's
// token (canMoveToken.ts mirrors the server's mode/turn decision purely for
// enable/disable — the server, via requireOwnParticipantOrDm +
// computeValidatedMoveCost, remains the sole source of truth and re-validates
// every move). Terrain painting stays DM-only.

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { Character, EncounterMode, EncounterStatus, CampaignAsset, MapElement, MapElementOrRedacted, MapElementType, SnapshotParticipant } from '../lib/types';
import type { MapConfig } from '../lib/socketTypes';
import { Portrait } from '../components/Portrait';
import { ImageUploadField } from '../components/ImageUploadField';
import { ErrorBanner, EmptyState, errorMessage } from '../components/Feedback';
import { Field, Input } from '../components/ui/Field';
import { Button } from '../components/ui/Button';
import { useAuth } from '../auth/AuthContext';
import { useLocale, type TranslationKey } from '../i18n/LocaleContext';
import { formatDistance } from '../lib/units';
import { canMoveToken } from './canMoveToken';
import { Token } from './Token';
import { controlBadgeFor } from './controlBadge';
import { zoomAtPoint, screenToWorld, snapToCell, type Viewport } from './geometry';
import { ELEMENT_REGISTRY, buildPreviewElement, renderMapElement } from './elements/registry';
import { ElementPalette } from './elements/ElementPalette';
import { MapCanvasElements } from './elements/MapCanvasElements';
import { ElementPropertyPanel } from './elements/ElementPropertyPanel';
import { DoorActionPanel } from './elements/DoorActionPanel';
import { useCreateMapElement, useSetMapElementsVisibilityBatch } from './elements/useMapElements';
import { VisionOverlay } from './vision/VisionOverlay';
import { useCampaignShell } from '../campaigns/CampaignShell';
import { TurnControlOverlay } from './TurnControlOverlay';
import type { MutationLike } from './BattleModeDmPanel';

const GRID_MIN = 5;
const GRID_MAX = 50;
const CELL_SIZE_MIN = 20;
const CELL_SIZE_MAX = 150;
const ZOOM_MIN = 0.1;
const ZOOM_MAX = 4;
const ZOOM_STEP = 0.25;
// Wheel zoom sensitivity — deltaY is typically ~100-120 per notch on a mouse
// wheel, much finer (~1-10) on a trackpad; this exponent gives a smooth
// continuous feel across both without a separate trackpad-detection branch.
const WHEEL_ZOOM_SENSITIVITY = 0.0015;
// Screen-pixel movement (regardless of zoom) a plain left-button pointer
// must travel before it's treated as a grab-to-pan drag rather than a click
// — keeps paint/move-target/placement cell clicks working (real clicks stay
// well under this) while still letting a left-drag on empty canvas pan.
const DRAG_PAN_THRESHOLD_PX = 4;

function clampZoom(z: number): number {
  return Math.min(Math.max(z, ZOOM_MIN), ZOOM_MAX);
}

type CostType = 'difficult' | 'impassable' | 'special';
interface CellOverride {
  x: number;
  y: number;
  cost_type: CostType;
  medium: 'ground' | 'water' | 'air' | 'underground';
  special_cost_ft: number | null;
  note: string | null;
}

// Paint-mode cycle: normal -> difficult -> impassable -> normal. 'special'
// (a DM-authored exact cost) is API-only for now, not reachable from this
// minimal click tool — see OPEN_QUESTIONS.md #6.
const PAINT_CYCLE: Array<CostType | null> = [null, 'difficult', 'impassable'];
const OVERRIDE_TINT: Record<CostType, string> = {
  difficult: 'bg-amber-700/30',
  impassable: 'bg-red-900/50',
  special: 'bg-purple-700/30',
};

function clamp(n: number, min: number, max: number): number {
  if (Number.isNaN(n)) return min;
  return Math.min(Math.max(Math.round(n), min), max);
}

/** 0-indexed column -> spreadsheet-style letter(s): 0='A', 25='Z', 26='AA'. */
function columnLabel(x: number): string {
  let col = '';
  let n = x;
  do {
    col = String.fromCharCode(65 + (n % 26)) + col;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return col;
}

/** "A1" style coordinate label — column letter(s) + 1-indexed row number. */
function cellLabel(x: number, y: number): string {
  return `${columnLabel(x)}${y + 1}`;
}

export function BattleMap({
  encounterId,
  campaignId,
  map,
  participants,
  mapElements,
  activeParticipantId,
  encounter,
  isDm,
  preview,
  requestPreviewSync,
  myCharacterIds = new Set(),
  characters,
  onOpenSheet,
  rollInitiativeMutation,
  advanceTurnMutation,
  previousTurnMutation,
}: {
  encounterId: string;
  campaignId: string;
  map: MapConfig | null;
  participants: SnapshotParticipant[];
  /** Generic DM map elements (walls/doors/lights/areas/notes/images) — see
   * encounters/elements/registry.tsx. GM-only visibility layer — a hidden
   * wall/door/light arrives as a RedactedMapElement (geometry-only) for a
   * non-DM/non-owner viewer; a hidden note/area/image is simply absent. */
  mapElements: MapElementOrRedacted[];
  activeParticipantId: string | null;
  /** mode/status/currentTurnIndex — enough for canMoveToken.ts's client-side
   * enable/disable mirror of the server's move-validation decision. */
  encounter: { mode: EncounterMode; status: EncounterStatus; currentTurnIndex: number };
  isDm: boolean;
  /** GM-only visibility layer — "view as player" preview snapshot (see
   * useEncounterLive.ts's useEncounterPreviewSync). While previewPlayerView
   * is on, the map canvas (tokens/elements/fog) renders from THIS
   * server-computed, actually-role-filtered payload instead of the DM's own
   * `participants`/`mapElements` — the only way to guarantee the preview
   * matches what a real player session renders, since the DM's own payload
   * always discloses everything. A point-in-time snapshot, not live-synced;
   * `requestPreviewSync` re-requests a fresh one. */
  preview?: { participants: SnapshotParticipant[]; mapElements: MapElementOrRedacted[] } | null;
  requestPreviewSync?: () => void;
  /** Character ids owned by the current user (empty for the DM, who doesn't
   * need it — isDm alone already grants unconditional control). Used to
   * decide which tokens a non-DM viewer may drag/tap-move/self-place. */
  myCharacterIds?: Set<string>;
  /** Iteration 2 "Character ownership vs. control" — full character rows
   * (not just the id Sets above), needed to distinguish "mine" from
   * "temporarily mine" for the corner control badge (controlBadge.ts).
   * Undefined renders every token with no badge, same as before this
   * iteration. */
  characters?: Character[];
  /** Nav point 3 — fires on a token DOUBLE click/tap, opening
   * ParticipantSheetPanel in the caller's floating overlay (per-participant
   * faction/visibility/HP controls live in the sheet and the DM "Manage"
   * overlay instead of a side-by-side roster list). Deliberately not tied to
   * single-click selection — a DM repositioning several tokens shouldn't get
   * a stats sheet popping open on every click. Purely additive: selection
   * itself still drives move-targeting exactly as before whether or not this
   * is supplied. */
  onOpenSheet?: (participantId: string) => void;
  /** Live Map turn overlay (map-corner panel, isDm-gated internally by the
   * caller — see SessionScreen.tsx) — the same roll-initiative/advance-turn/
   * previous-turn mutations BattleModeDmPanel.tsx's Manage overlay already
   * calls, threaded here so the DM can trigger them without leaving the map.
   * All three optional so BattleMap stays usable standalone (e.g.
   * maps/FullscreenMapPage.tsx) without wiring turn control at all. */
  rollInitiativeMutation?: MutationLike<boolean>;
  advanceTurnMutation?: MutationLike<void>;
  previousTurnMutation?: MutationLike<void>;
}) {
  const { t } = useLocale();
  const { user } = useAuth();
  const { campaign } = useCampaignShell();
  const [showSetup, setShowSetup] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Phase 2 multi-select (shift-click) — separate from selectedId (which
  // still drives reachable-cell highlighting/the sheet-opening selection);
  // this only tracks "which tokens move together on the next drag."
  const [multiSelectedIds, setMultiSelectedIds] = useState<Set<string>>(new Set());
  // Phase 2 grid-snap toggle — drag-preview smoothness only (Token.tsx); the
  // dropped cell is always whole-cell regardless of this setting.
  const [snapToGrid, setSnapToGrid] = useState(true);
  // Phase 2 fog-of-war — the DM's own view never shows fog; this toggles a
  // preview of exactly what a player would see (union of player-faction
  // token vision). Real (non-DM) viewers always see it, unconditionally.
  const [previewPlayerView, setPreviewPlayerView] = useState(false);
  // GM-only visibility layer — preview is a point-in-time snapshot, not a
  // live-synced stream (see useEncounterLive.ts's useEncounterPreviewSync
  // doc comment on why); this local timestamp drives the "snapshot as of…"
  // caption so a DM isn't misled into thinking it's tracking live moves.
  const [previewRequestedAt, setPreviewRequestedAt] = useState<Date | null>(null);
  const [paintMode, setPaintMode] = useState(false);
  // Generic map elements (walls/doors/lights/areas/notes/images) — mirrors
  // paintMode's own shape. `elementEditMode` shows the palette + lets
  // existing elements be clicked to open their property panel;
  // `placingType`/`placingPoints` track an in-progress placement (segment
  // types need two clicks, polygon types need >=3 before "Finish").
  const [elementEditMode, setElementEditMode] = useState(false);
  const [placingType, setPlacingType] = useState<MapElementType | null>(null);
  const [placingPoints, setPlacingPoints] = useState<{ x: number; y: number }[]>([]);
  // Live placement preview (Target State - Element placement: "live preview
  // under cursor before commit") — which grid cell the pointer is currently
  // over while a placement tool is active. Cell-granularity, matching the
  // grid-snapped precision every placement type already commits at.
  const [placementHoverCell, setPlacementHoverCell] = useState<{ x: number; y: number } | null>(null);
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null);
  // GM-only visibility layer — multi-select for the bulk reveal/hide
  // toolbar, mirroring the token multi-select shift-click pattern
  // (multiSelectedIds above) but kept separate since elements and tokens
  // are different selection domains.
  const [selectedElementIds, setSelectedElementIds] = useState<Set<string>>(new Set());
  // Tap-to-move (docs/design-tokens.md mobile pass): "dragging is unreliable
  // with a finger covering the target — tap to select, then tap-destination,
  // then an explicit confirm control ... with an obvious cancel." Additive,
  // not a replacement for drag — a DM can still drag on desktop; this is a
  // second path to the same positionMutation below, for when a finger is in
  // the way of precise dragging.
  const [pendingMove, setPendingMove] = useState<{ x: number; y: number } | null>(null);
  // Direct DM/DM+player "type the exact cell" input (Target State: "also by
  // entering exact coordinates") — feeds the SAME pendingMove/confirm flow
  // as a map click or a drag drop, so it gets the same reachable-cell
  // feedback and the same server-validated commit; it's just a third way to
  // choose the target cell, not a separate write path. Reset whenever the
  // selection changes so stale digits from a previous token never carry over.
  const [coordInput, setCoordInput] = useState<{ x: string; y: string }>({ x: '', y: '' });
  // Client-side, session-only move undo (approved scope: no server/schema
  // changes, lost on refresh). Tracks the PRE-move cell(s) of whatever move
  // was just committed — group moves record every member so undo restores
  // the whole formation, not just the token that was actually dragged.
  // Restoring via a second position PATCH is a genuine move through the same
  // validated-cost pipeline as any other drag: free where the original move
  // was free (DM control, non-active-turn, exploration mode — see
  // computeValidatedMoveCost), but a real costed backtrack during an active
  // turn spends movement again, same as walking back anywhere else would —
  // there is no server refund mechanism for this (addMovementFt is
  // strictly positive), so this deliberately does NOT claim to restore
  // movementRemaining for that case; the undo button's title says so.
  const [lastMove, setLastMove] = useState<Array<{ participantId: string; x: number; y: number }> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();

  // Single source of truth for the infinite-canvas viewport — completely
  // independent of grid/map config (see the effect below, which only ever
  // fits it once on initial map load, never on a grid dimension/cell-size
  // change). Content renders via `transform: translate(panX,panY)
  // scale(zoom)`; per CSS's transform-composition order scale applies first
  // (in world space) and translate second (in screen space), so panX/panY
  // are always plain screen pixels regardless of zoom — see geometry.ts's
  // Viewport doc comment.
  const [viewport, setViewport] = useState<Viewport>({ panX: 0, panY: 0, zoom: 1 });

  function zoomAtScreenPoint(screenX: number, screenY: number, targetZoom: number) {
    setViewport((prev) => zoomAtPoint(screenX, screenY, clampZoom(targetZoom), prev));
  }

  function zoomAtContainerCenter(targetZoom: number) {
    const el = containerRef.current;
    if (!el) {
      setViewport((prev) => ({ ...prev, zoom: clampZoom(targetZoom) }));
      return;
    }
    zoomAtScreenPoint(el.clientWidth / 2, el.clientHeight / 2, targetZoom);
  }

  // Space-drag panning (docs brief: "pan via middle-drag and space-drag").
  // Scoped to window so the key registers regardless of which element has
  // focus; token draggability is gated off while held (isDraggable prop
  // below) so a space-drag never gets hijacked into a token move.
  const [spacePressed, setSpacePressed] = useState(false);
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.code === 'Space' && !e.repeat) setSpacePressed(true);
    }
    function onKeyUp(e: KeyboardEvent) {
      if (e.code === 'Space') setSpacePressed(false);
    }
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  // Pinch-to-zoom + grab-to-pan, unified over raw Pointer Events (same
  // primitive Token.tsx's drag already uses) since the viewport is no longer
  // a native-scrollable element (no more `overflow-auto` — see the container
  // div below) — panning is now applied to `viewport.panX/panY` directly
  // instead of relying on native scroll. Two concurrent pointers ->
  // pinch-zoom, anchored at their midpoint. Middle-click, a space-held
  // left-click, or any touch pointer starts panning immediately (preserving
  // this app's existing single-finger-pans-the-map mobile behavior now that
  // native scroll can no longer provide it). A plain left-click is ambiguous
  // up front — it might be a click on a paint/move-target/placement cell
  // underneath, or the start of a grab-to-pan drag — so it's tracked as a
  // `leftDragCandidate` and only promoted to a real pan once it moves past
  // DRAG_PAN_THRESHOLD_PX (handleMapPointerMove); a real click stays well
  // under that and reaches the cell/token handlers underneath untouched.
  // Token.tsx's own pointerDown stops propagation for its own draggable
  // primary-button drags, so this never double-handles a token drag as a pan.
  const activePointers = useRef(new Map<number, { x: number; y: number }>());
  const pinchStart = useRef<{ distance: number; midX: number; midY: number; zoom: number } | null>(null);
  const panState = useRef<{ pointerId: number; lastX: number; lastY: number } | null>(null);
  const leftDragCandidate = useRef<{ pointerId: number; startX: number; startY: number } | null>(null);
  // Set the instant a leftDragCandidate is promoted to a real pan; checked
  // (and cleared) by handleCellClick so the click that follows pointerup
  // after a real drag never also fires the cell's paint/move-target/
  // placement action.
  const justPannedRef = useRef(false);

  function pointerMidpointAndDistance(): { distance: number; midX: number; midY: number } | null {
    const pts = [...activePointers.current.values()];
    if (pts.length < 2) return null;
    const [a, b] = pts;
    return { distance: Math.hypot(a!.x - b!.x, a!.y - b!.y), midX: (a!.x + b!.x) / 2, midY: (a!.y + b!.y) / 2 };
  }

  function containerRelative(clientX: number, clientY: number): { x: number; y: number } {
    const rect = containerRef.current?.getBoundingClientRect();
    return { x: clientX - (rect?.left ?? 0), y: clientY - (rect?.top ?? 0) };
  }

  function handleMapPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    activePointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pinch = pointerMidpointAndDistance();
    if (pinch) {
      panState.current = null;
      leftDragCandidate.current = null;
      pinchStart.current = { ...pinch, zoom: viewport.zoom };
      return;
    }
    const isMiddle = e.button === 1;
    const isSpacePan = e.button === 0 && spacePressed;
    const isTouchPan = e.pointerType === 'touch';
    if (isMiddle || isSpacePan || isTouchPan) {
      if (isMiddle) e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      panState.current = { pointerId: e.pointerId, lastX: e.clientX, lastY: e.clientY };
      return;
    }
    if (e.button === 0) {
      leftDragCandidate.current = { pointerId: e.pointerId, startX: e.clientX, startY: e.clientY };
    }
  }

  function handleMapPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (activePointers.current.has(e.pointerId)) activePointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinchStart.current) {
      const pinch = pointerMidpointAndDistance();
      if (!pinch || pinchStart.current.distance === 0) return;
      const anchor = containerRelative(pinch.midX, pinch.midY);
      zoomAtScreenPoint(anchor.x, anchor.y, pinchStart.current.zoom * (pinch.distance / pinchStart.current.distance));
      return;
    }
    const candidate = leftDragCandidate.current;
    if (candidate && candidate.pointerId === e.pointerId) {
      const dx = e.clientX - candidate.startX;
      const dy = e.clientY - candidate.startY;
      if (Math.hypot(dx, dy) < DRAG_PAN_THRESHOLD_PX) return;
      // Promote: this is a grab-to-pan drag, not a click. Capture now (not
      // at pointerdown) so a real click's pointerup/click still lands
      // untouched on whatever cell/token was under the pointer.
      containerRef.current?.setPointerCapture(e.pointerId);
      panState.current = { pointerId: e.pointerId, lastX: e.clientX, lastY: e.clientY };
      justPannedRef.current = true;
      leftDragCandidate.current = null;
      // Falls through to the pan branch below, applied from this same
      // event (dx/dy against the freshly-set lastX/lastY is 0 for this
      // tick — no jump — subsequent moves pan normally).
    }
    const pan = panState.current;
    if (pan && pan.pointerId === e.pointerId) {
      const dx = e.clientX - pan.lastX;
      const dy = e.clientY - pan.lastY;
      panState.current = { ...pan, lastX: e.clientX, lastY: e.clientY };
      setViewport((prev) => ({ ...prev, panX: prev.panX + dx, panY: prev.panY + dy }));
    }
  }

  function handleMapPointerUp(e: ReactPointerEvent<HTMLDivElement>) {
    activePointers.current.delete(e.pointerId);
    if (activePointers.current.size < 2) pinchStart.current = null;
    if (panState.current?.pointerId === e.pointerId) panState.current = null;
    if (leftDragCandidate.current?.pointerId === e.pointerId) leftDragCandidate.current = null;
    // Self-heals justPannedRef for a pan that ends somewhere with no click
    // handler to consume the flag (e.g. paint/move-target mode is off) —
    // without this, that pan would silently swallow the NEXT unrelated
    // click instead of just this one. The native click event (if any) for
    // this same pointerup fires synchronously before this timeout runs, so
    // handleCellClick still sees the flag in time to suppress its own click.
    if (justPannedRef.current) {
      setTimeout(() => {
        justPannedRef.current = false;
      }, 0);
    }
  }

  // Element geometry (registry.tsx) is authored in grid-VERTEX space (a wall
  // from (0,0)->(1,0) draws exactly along the top grid line — see
  // segmentStyle's `el.x1 * cellSizePx`), a (gridColumns+1) x (gridRows+1)
  // space of points, distinct from the CELL-index space (gridColumns x
  // gridRows) tokens/paint/move-target use. Converts a raw pointer position
  // straight to world space (screenToWorld) then to the nearest vertex
  // (snapToCell, applied to a continuous world-pixel coordinate rather than
  // a fixed per-cell index) — this is what makes placement land where the
  // cursor actually is, anywhere in the cell, instead of always snapping to
  // whichever cell's div happened to receive the click.
  function pointerToVertex(clientX: number, clientY: number): { x: number; y: number } {
    if (!map) return { x: 0, y: 0 };
    const screen = containerRelative(clientX, clientY);
    const world = screenToWorld(screen.x, screen.y, viewport);
    return {
      x: Math.min(Math.max(snapToCell(world.x, map.cellSizePx), 0), map.gridColumns),
      y: Math.min(Math.max(snapToCell(world.y, map.cellSizePx), 0), map.gridRows),
    };
  }

  // Gate for every paint/move-target/element-placement cell click — a real
  // drag-to-pan that started on that same cell (justPannedRef, set by
  // handleMapPointerMove's promotion above) must not also trigger the
  // cell's click action once the pointer lifts. `x`/`y` (the containing
  // cell's own index) still drive paint/move-target, which are genuinely
  // cell-scoped; placement instead re-derives a precise VERTEX from the
  // click's own screen position via pointerToVertex, ignoring the coarser
  // per-cell x/y.
  function handleCellClick(x: number, y: number, e: React.MouseEvent) {
    if (justPannedRef.current) {
      justPannedRef.current = false;
      return;
    }
    if (placingType) {
      const vertex = pointerToVertex(e.clientX, e.clientY);
      handleElementPlacementClick(vertex.x, vertex.y);
    } else if (paintMode) {
      handleCellPaint(x, y);
    } else if (moveTargetMode) {
      setPendingMove({ x, y });
    }
  }

  // Wheel handling, attached as a native (non-passive) listener rather than
  // React's synthetic onWheel — React 17+ attaches onWheel at the root as a
  // passive listener by default, which silently drops preventDefault() and
  // lets the page itself scroll/zoom underneath. Reads/writes viewport only
  // through the functional setViewport updater above, so this never closes
  // over a stale zoom/pan and can be attached once on mount.
  //
  // Branches on ctrlKey, not device type (which a wheel event can't reliably
  // report): a trackpad's pinch gesture is delivered by the browser as a
  // wheel event with ctrlKey synthetically set to true (same signal a mouse
  // user gets by manually holding Ctrl/Cmd while scrolling) — that's the
  // zoom gesture. Plain wheel with no ctrlKey covers both a mouse's actual
  // wheel notches AND — critically — a trackpad's two-finger scroll, which
  // is a laptop user's natural pan gesture; a version of this handler that
  // zoomed on every wheel event (no ctrlKey branch) hijacked that gesture
  // into zooming instead of panning, which is what "panning doesn't work"
  // looks like on a trackpad. Pan applies deltaX/deltaY directly to
  // panX/panY: both are already plain screen pixels regardless of zoom (see
  // the Viewport doc comment in geometry.ts), same invariant the pointer-pan
  // handlers below rely on.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    function onWheel(e: WheelEvent) {
      e.preventDefault();
      if (e.ctrlKey) {
        const rect = el!.getBoundingClientRect();
        const screenX = e.clientX - rect.left;
        const screenY = e.clientY - rect.top;
        setViewport((prev) => {
          const targetZoom = clampZoom(prev.zoom * Math.exp(-e.deltaY * WHEEL_ZOOM_SENSITIVITY));
          return zoomAtPoint(screenX, screenY, targetZoom, prev);
        });
        return;
      }
      setViewport((prev) => ({ ...prev, panX: prev.panX - e.deltaX, panY: prev.panY - e.deltaY }));
    }
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const positionMutation = useMutation({
    mutationFn: ({ participantId, x, y }: { participantId: string; x: number | null; y: number | null }) =>
      api.patch(`/encounters/${encounterId}/participants/${participantId}/position`, { x, y }),
    // No cache write on success, on purpose: TOKEN_MOVED arriving over the
    // socket (which the DM's own action also triggers) is the single source
    // of truth for token position, same discipline as CombatTracker's
    // hpMutation/applyEffectMutation.
    onSuccess: () => setPendingMove(null),
  });

  // REFACTOR-PLAN.md §4: terrain overlay + the DM's paint tool. DM-only read
  // (see routes/encounters.ts) — not refetched on every socket tick (terrain
  // changes far less often than combat state); the paint mutation below
  // invalidates it directly on success, which covers the single-DM-tab case
  // this app is built around today.
  const overridesQuery = useQuery({
    queryKey: ['encounter', encounterId, 'cell-overrides'],
    queryFn: () => api.get<{ overrides: CellOverride[] }>(`/encounters/${encounterId}/map/cell-overrides`),
    enabled: isDm,
  });
  const overridesByCell = new Map((overridesQuery.data?.overrides ?? []).map((o) => [`${o.x},${o.y}`, o]));

  const paintMutation = useMutation({
    mutationFn: ({ x, y, costType }: { x: number; y: number; costType: CostType | null }) =>
      costType === null
        ? api.delete(`/encounters/${encounterId}/map/cell-overrides/${x}/${y}`)
        : api.put(`/encounters/${encounterId}/map/cell-overrides/${x}/${y}`, { costType }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['encounter', encounterId, 'cell-overrides'] });
    },
  });

  function handleCellPaint(x: number, y: number) {
    const current = overridesByCell.get(`${x},${y}`)?.cost_type ?? null;
    const next = PAINT_CYCLE[(PAINT_CYCLE.indexOf(current) + 1) % PAINT_CYCLE.length]!;
    paintMutation.mutate({ x, y, costType: next });
  }

  // Same query key as MapSetupPanel's assets fetch below — TanStack Query
  // dedups/shares the cache entry, so this doesn't add a second network
  // request whenever that panel happens to also be open. Membership-gated
  // server-side (not DM-only): image elements need to render for players too.
  const assetsQuery = useQuery({
    queryKey: ['campaign', campaignId, 'assets'],
    queryFn: () => api.get<{ assets: CampaignAsset[] }>(`/campaigns/${campaignId}/assets`),
  });
  const assetUrlById = new Map((assetsQuery.data?.assets ?? []).map((a) => [a.id, a.file_url]));
  function resolveAssetUrl(assetId: string): string | undefined {
    return assetUrlById.get(assetId);
  }

  const createElementMutation = useCreateMapElement(encounterId);
  const setElementsVisibilityBatchMutation = useSetMapElementsVisibilityBatch(encounterId);
  // Per-map lighting state (nav point 4) — MAP_UPDATED (broadcast by the
  // route) is the live-sync path; no local cache write needed here.
  const setLightingMutation = useMutation({
    mutationFn: (lightingState: 'bright' | 'dim' | 'dark') =>
      api.patch(`/encounters/${encounterId}/map/lighting`, { lightingState }),
  });
  // Only the DM can select an element for editing (elementEditMode is
  // isDm-gated below), and the DM's own payload is always the full,
  // unredacted shape — this filter is a type-narrowing formality, not a
  // real-world redacted-element exclusion.
  const selectedElement =
    mapElements.find((el): el is MapElement => el.id === selectedElementId && !('redacted' in el && el.redacted)) ?? null;

  // GM-only visibility layer — same shift-click-toggles-membership /
  // plain-click-clears pattern as handleTokenClick above.
  function handleElementClick(elementId: string, e: React.MouseEvent) {
    if (placingType) return;
    if (e.shiftKey) {
      setSelectedElementIds((prev) => {
        const next = new Set(prev);
        if (next.has(elementId)) next.delete(elementId);
        else next.add(elementId);
        return next;
      });
      return;
    }
    setSelectedElementIds(new Set());
    setSelectedElementId(elementId);
  }

  function handleBulkElementVisibility(visibility: 'gm_only' | 'revealed_to_players') {
    if (selectedElementIds.size === 0) return;
    setElementsVisibilityBatchMutation.mutate(
      { elementIds: [...selectedElementIds], visibility },
      { onSuccess: () => setSelectedElementIds(new Set()) },
    );
  }

  function cancelPlacement() {
    setPlacingType(null);
    setPlacingPoints([]);
    setPlacementHoverCell(null);
  }

  // Target State - Element placement: "Escape cancels in-progress
  // placement." Scoped to window (same pattern as the space-drag key
  // tracking above) so it fires regardless of which element has focus.
  useEffect(() => {
    if (!placingType) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') cancelPlacement();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placingType]);

  // Generic over ELEMENT_REGISTRY's `placement` field — a 'point' type
  // creates on the first click, a 'segment' type needs two clicks (start,
  // end), a 'polygon' type accumulates clicks until finishPolygonPlacement
  // is called. No type-specific branch: every type funnels through
  // entry.defaults() for its props/label/visibility.
  function handleElementPlacementClick(x: number, y: number) {
    if (!placingType) return;
    const entry = ELEMENT_REGISTRY[placingType];
    if (entry.placement === 'point') {
      const d = entry.defaults();
      createElementMutation.mutate({ type: placingType, x1: x, y1: y, props: d.props, label: d.label, visibility: d.visibility });
      cancelPlacement();
      return;
    }
    if (entry.placement === 'segment') {
      if (placingPoints.length === 0) {
        setPlacingPoints([{ x, y }]);
        return;
      }
      const start = placingPoints[0]!;
      const d = entry.defaults();
      createElementMutation.mutate({
        type: placingType,
        x1: start.x,
        y1: start.y,
        x2: x,
        y2: y,
        props: d.props,
        label: d.label,
        visibility: d.visibility,
      });
      cancelPlacement();
      return;
    }
    // polygon
    setPlacingPoints((prev) => [...prev, { x, y }]);
  }

  function finishPolygonPlacement() {
    if (!placingType || placingPoints.length < 3) return;
    const entry = ELEMENT_REGISTRY[placingType];
    const d = entry.defaults();
    const anchor = placingPoints[0]!;
    createElementMutation.mutate({
      type: placingType,
      x1: anchor.x,
      y1: anchor.y,
      points: placingPoints,
      props: d.props,
      label: d.label,
      visibility: d.visibility,
    });
    cancelPlacement();
  }

  function isOwnToken(p: SnapshotParticipant): boolean {
    return p.characterId != null && myCharacterIds.has(p.characterId);
  }
  function canControl(p: SnapshotParticipant): boolean {
    return canMoveToken(encounter, { turnOrder: p.turnOrder }, isOwnToken(p), isDm);
  }

  // REFACTOR-PLAN.md §4: "selecting a character highlights reachable cells
  // based on remaining speed, computed with pathfinding over actual terrain
  // cost." Server-computed (never re-derived client-side) — see
  // docs/rules/movement.md. Enabled for the DM or for a player who selected
  // their OWN token (matches requireOwnParticipantOrDm's server-side gate on
  // the /reachable route itself — this is just when the client bothers to
  // ask).
  const selectedParticipant = participants.find((p) => p.participantId === selectedId) ?? null;
  const canControlSelected = selectedParticipant != null && (isDm || isOwnToken(selectedParticipant));
  // Keyed on the selected participant's own position/movement usage (not
  // just their id) so ANY move — a drag, a tap-confirm, an exact-coordinate
  // move, an undo, or another viewer's TOKEN_MOVED arriving over the socket
  // — produces a fresh cache key and therefore a fresh fetch. Previously
  // keyed on selectedId alone: the overlay kept showing the PRE-move
  // reachable set until the token was deselected and reselected (toggling
  // `enabled`), since nothing else ever invalidated this query — bug: stale
  // range after moving without deselecting.
  const reachableQuery = useQuery({
    queryKey: [
      'encounter',
      encounterId,
      'reachable',
      selectedId,
      selectedParticipant?.posX,
      selectedParticipant?.posY,
      selectedParticipant?.movementUsedFt,
      selectedParticipant?.dashUsed,
    ],
    queryFn: () =>
      api.get<{ cells: string[]; remainingFt: number; spentCells: string[] }>(
        `/encounters/${encounterId}/participants/${selectedId}/reachable`,
      ),
    enabled: canControlSelected,
  });
  const reachableCells = new Set(reachableQuery.data?.cells ?? []);
  // Cells reachable at this turn's FULL speed but no longer reachable given
  // movement already spent — rendered with a distinct "used up" treatment so
  // the overlay reads as "here's your whole potential footprint, and here's
  // what's left of it" rather than a single flat cutoff.
  const spentMovementCells = new Set(reachableQuery.data?.spentCells ?? []);
  // Initial placement (from null,null) is always a free move server-side
  // regardless of mode/turn (computeValidatedMoveCost) — so a selected
  // unplaced token only needs the plain ownership check (canControlSelected),
  // not canMoveToken's turn-order gate, which is about ALREADY-placed
  // repositioning during active combat and would otherwise wrongly block a
  // player from dropping their own not-yet-seated character outside their
  // turn.
  const selectedIsUnplaced = selectedParticipant != null && (selectedParticipant.posX == null || selectedParticipant.posY == null);
  const moveTargetMode =
    !paintMode && selectedParticipant != null && (selectedIsUnplaced ? canControlSelected : canControl(selectedParticipant));
  const pendingMoveIsReachable = pendingMove != null && (reachableCells.size === 0 || reachableCells.has(`${pendingMove.x},${pendingMove.y}`));

  // REFACTOR-PLAN.md §1: "on map load, spawn the creature instances assigned
  // to that map only if alive." Character participants (monsterInstanceStatus
  // null) are unaffected; a dead/fled/captured monster instance stays in the
  // initiative roster but never renders a token, placed or not.
  const spawnable = participants.filter((p) => p.monsterInstanceStatus === null || p.monsterInstanceStatus === 'alive');
  const placed = spawnable.filter((p) => p.posX != null && p.posY != null);
  const unplaced = spawnable.filter((p) => p.posX == null || p.posY == null);
  const unplacedControllable = unplaced.filter((p) => isDm || isOwnToken(p));

  // GM-only visibility layer — "view as player" preview. Only the map
  // CANVAS (tokens/elements/fog) switches render source while previewing;
  // the DM's own roster/side-panel controls above are unaffected. Falls
  // back to the DM's own (real, unfiltered) data if a preview hasn't been
  // requested yet, so toggling the preview on doesn't blank the map for the
  // instant before the server responds.
  const previewActive = isDm && previewPlayerView && preview != null;
  const canvasParticipants = previewActive ? preview!.participants : participants;
  const canvasMapElements = previewActive ? preview!.mapElements : mapElements;
  const canvasIsDm = previewActive ? false : isDm;
  const previewPlaced = previewActive
    ? canvasParticipants.filter(
        (p) => (p.monsterInstanceStatus === null || p.monsterInstanceStatus === 'alive') && p.posX != null && p.posY != null,
      )
    : placed;

  function selectParticipant(id: string | null) {
    setSelectedId(id);
    setPendingMove(null);
    setCoordInput({ x: '', y: '' });
  }

  // Shift-click toggles multi-select membership without disturbing the
  // primary selection (reachable-cell highlighting stays keyed on selectedId
  // alone). A plain click clears any multi-selection — dragging a token
  // that ISN'T part of a multi-select group should never accidentally drag
  // stale group members from a previous selection.
  function handleTokenClick(participantId: string, e: React.MouseEvent) {
    if (e.shiftKey) {
      setMultiSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(participantId)) next.delete(participantId);
        else next.add(participantId);
        return next;
      });
      return;
    }
    setMultiSelectedIds(new Set());
    selectParticipant(selectedId === participantId ? null : participantId);
  }

  // Group-move (Phase 2): if the dragged token is part of a multi-select
  // group of 2+, every other member moves by the same cell delta, clamped
  // to the grid bounds. One sequential PATCH per participant — not atomic
  // server-side, an accepted v1 risk (see the approved plan's cross-cutting
  // decisions) rather than a new batch-move endpoint.
  function handleTokenMove(participant: SnapshotParticipant, x: number, y: number) {
    if (!map) return;
    const group = multiSelectedIds.has(participant.participantId) && multiSelectedIds.size > 1 ? multiSelectedIds : null;
    if (!group) {
      if (participant.posX != null && participant.posY != null) {
        setLastMove([{ participantId: participant.participantId, x: participant.posX, y: participant.posY }]);
      }
      positionMutation.mutate({ participantId: participant.participantId, x, y });
      return;
    }
    const dx = x - (participant.posX ?? x);
    const dy = y - (participant.posY ?? y);
    const priorPositions: Array<{ participantId: string; x: number; y: number }> = [];
    for (const id of group) {
      const member = placed.find((p) => p.participantId === id);
      if (!member || member.posX == null || member.posY == null) continue;
      priorPositions.push({ participantId: id, x: member.posX, y: member.posY });
      const nx = Math.min(Math.max(member.posX + dx, 0), map.gridColumns - 1);
      const ny = Math.min(Math.max(member.posY + dy, 0), map.gridRows - 1);
      positionMutation.mutate({ participantId: id, x: nx, y: ny });
    }
    if (priorPositions.length > 0) setLastMove(priorPositions);
  }

  function undoLastMove() {
    if (!lastMove) return;
    for (const { participantId, x, y } of lastMove) {
      positionMutation.mutate({ participantId, x, y });
    }
    setLastMove(null);
  }

  // Pans (no zoom change) so the active participant's token centers in the
  // viewport — an instant pan-set on the single viewport state, not a
  // native scrollTo (there's no scrollable element anymore).
  function centerOnActive() {
    const el = containerRef.current;
    if (!el || !map || activeParticipantId == null) return;
    const active = placed.find((p) => p.participantId === activeParticipantId);
    if (!active || active.posX == null || active.posY == null) return;
    const worldX = (active.posX + 0.5) * map.cellSizePx;
    const worldY = (active.posY + 0.5) * map.cellSizePx;
    setViewport((prev) => ({
      ...prev,
      panX: el.clientWidth / 2 - worldX * prev.zoom,
      panY: el.clientHeight / 2 - worldY * prev.zoom,
    }));
  }

  const mapWidthPx = map ? map.gridColumns * map.cellSizePx : 0;
  const mapHeightPx = map ? map.gridRows * map.cellSizePx : 0;

  // "Contain" fit (min of both axis ratios) + centering — frames the WHOLE
  // map with no letterboxing distortion, leaving empty canvas on one axis
  // for a non-matching aspect ratio rather than cropping. Unlike the old
  // scroll-container model, empty canvas here costs nothing and looks
  // intentional (this is an infinite canvas, not a document that "should"
  // fill edge-to-edge) — so contain/min replaces the old max-based "fill at
  // least one axis" fit, which existed only to avoid dead space inside a
  // native-scrollbar container that no longer exists.
  function computeFitViewport(width: number, height: number): Viewport {
    if (mapWidthPx <= 0 || mapHeightPx <= 0) return { panX: 0, panY: 0, zoom: 1 };
    const fitZoom = clampZoom(Math.min(width / mapWidthPx, height / mapHeightPx));
    return { zoom: fitZoom, panX: (width - mapWidthPx * fitZoom) / 2, panY: (height - mapHeightPx * fitZoom) / 2 };
  }

  function fitToScreen() {
    const el = containerRef.current;
    if (!el) return;
    setViewport(computeFitViewport(el.clientWidth, el.clientHeight));
  }

  function resetTo100() {
    zoomAtContainerCenter(1);
  }

  // Auto-fits exactly ONCE per map (keyed on map.id, not on
  // gridColumns/gridRows/cellSizePx) — the core viewport/grid decoupling
  // this rewrite exists for: reconfiguring the grid must never move pan/zoom
  // out from under the DM. A ResizeObserver (not a plain mount effect) is
  // still needed for the very first fit specifically because the container
  // may not have its final flex-computed size yet on first paint/under
  // StrictMode's dev-only mount->cleanup->mount cycle — the observer's first
  // callback is the first point a real contentRect is guaranteed.
  const fittedMapIdRef = useRef<string | null>(null);
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !map) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry || fittedMapIdRef.current === map.id) return;
      fittedMapIdRef.current = map.id;
      setViewport(computeFitViewport(entry.contentRect.width, entry.contentRect.height));
    });
    observer.observe(el);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map?.id]);

  // Live placement preview ghost — generic over ELEMENT_REGISTRY via
  // buildPreviewElement (registry.tsx), so this never branches on
  // `placingType` beyond the same `placement` field BattleMap already
  // switches on elsewhere for placement hints. 'point': previews at the
  // hovered cell directly. 'segment': nothing until the start point is
  // placed, then previews live from there to the hovered cell. 'polygon':
  // nothing until the first point, then previews the accumulated points
  // plus a live edge out to the hovered cell.
  let placementPreviewElement: MapElement | null = null;
  if (placingType && placementHoverCell) {
    const entry = ELEMENT_REGISTRY[placingType];
    if (entry.placement === 'point') {
      placementPreviewElement = buildPreviewElement(placingType, placementHoverCell.x, placementHoverCell.y, null, null, null);
    } else if (entry.placement === 'segment' && placingPoints.length === 1) {
      const start = placingPoints[0]!;
      placementPreviewElement = buildPreviewElement(placingType, start.x, start.y, placementHoverCell.x, placementHoverCell.y, null);
    } else if (entry.placement === 'polygon' && placingPoints.length >= 1) {
      const anchor = placingPoints[0]!;
      placementPreviewElement = buildPreviewElement(placingType, anchor.x, anchor.y, null, null, [...placingPoints, placementHoverCell]);
    }
  }

  if (!map) {
    return (
      <div className="flex h-full flex-col gap-4">
        {isDm ? (
          <>
            <EmptyState message={t('encounters.battleMap.noMapConfigured')} />
            <MapSetupPanel campaignId={campaignId} encounterId={encounterId} map={null} onDone={() => {}} />
          </>
        ) : (
          <EmptyState message={t('encounters.battleMap.noMapFromDm')} />
        )}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-4">
      {positionMutation.isError && <ErrorBanner message={errorMessage(positionMutation.error)} />}
      {createElementMutation.isError && <ErrorBanner message={errorMessage(createElementMutation.error)} />}

      <div className="flex flex-shrink-0 items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-1 flex-wrap">
          <button
            type="button"
            onClick={() => zoomAtContainerCenter(viewport.zoom - ZOOM_STEP)}
            disabled={viewport.zoom <= ZOOM_MIN}
            aria-label={t('encounters.battleMap.zoomOut')}
            className="min-h-11 min-w-11 rounded-md bg-stone-900 shadow-sm text-sm text-stone-300 hover:bg-stone-800 disabled:opacity-40"
          >
            −
          </button>
          <span className="text-xs text-stone-400 w-12 text-center">{Math.round(viewport.zoom * 100)}%</span>
          <button
            type="button"
            onClick={() => zoomAtContainerCenter(viewport.zoom + ZOOM_STEP)}
            disabled={viewport.zoom >= ZOOM_MAX}
            aria-label={t('encounters.battleMap.zoomIn')}
            className="min-h-11 min-w-11 rounded-md bg-stone-900 shadow-sm text-sm text-stone-300 hover:bg-stone-800 disabled:opacity-40"
          >
            +
          </button>
          <button
            type="button"
            onClick={resetTo100}
            className="min-h-11 rounded-md bg-stone-900 shadow-sm px-3 text-xs text-stone-400 hover:bg-stone-800"
          >
            {t('encounters.battleMap.reset')}
          </button>
          <button
            type="button"
            onClick={fitToScreen}
            className="min-h-11 rounded-md bg-stone-900 shadow-sm px-3 text-xs text-stone-400 hover:bg-stone-800"
          >
            {t('encounters.battleMap.fitToScreen')}
          </button>
          <button
            type="button"
            onClick={centerOnActive}
            disabled={activeParticipantId == null}
            className="min-h-11 rounded-md bg-stone-900 shadow-sm px-3 text-xs text-stone-400 hover:bg-stone-800 disabled:opacity-40"
          >
            {t('encounters.battleMap.centerOnActive')}
          </button>
          <span className="hidden text-[10px] text-stone-600 sm:inline" title={t('encounters.battleMap.panHint')}>
            {t('encounters.battleMap.panHint')}
          </span>
          <button
            type="button"
            onClick={() => setSnapToGrid((s) => !s)}
            aria-pressed={snapToGrid}
            title={t('encounters.battleMap.snapToGridTitle')}
            className={`min-h-11 rounded-md px-3 text-xs ${
              snapToGrid ? 'bg-amber-950/30 text-amber-400 outline outline-1 outline-amber-600' : 'bg-stone-900 shadow-sm text-stone-400 hover:bg-stone-800'
            }`}
          >
            {t('encounters.battleMap.snapToGrid')}
          </button>
          {lastMove && (
            <button
              type="button"
              onClick={undoLastMove}
              disabled={positionMutation.isPending}
              title={t('encounters.battleMap.undoMoveTitle')}
              className="min-h-11 rounded-md bg-stone-900 shadow-sm px-3 text-xs text-stone-400 hover:bg-stone-800 disabled:opacity-40"
            >
              {t('encounters.battleMap.undoMove')}
            </button>
          )}
          {!isDm && (
            <span className="text-xs text-stone-500 ml-1">{t('encounters.battleMap.fogActiveHint')}</span>
          )}
          {isDm && (
            <button
              type="button"
              onClick={() => {
                setPreviewPlayerView((s) => {
                  const next = !s;
                  // GM-only visibility layer — request a fresh player-role
                  // snapshot the moment preview turns on, so the canvas has
                  // real data to switch to rather than blanking until some
                  // other trigger happens to call requestPreviewSync.
                  if (next) {
                    requestPreviewSync?.();
                    setPreviewRequestedAt(new Date());
                  }
                  return next;
                });
              }}
              aria-pressed={previewPlayerView}
              title={t('encounters.battleMap.previewPlayerViewTitle')}
              className={`min-h-11 rounded-md px-3 text-xs ${
                previewPlayerView ? 'bg-sky-950/30 text-sky-400 outline outline-1 outline-sky-600' : 'bg-stone-900 shadow-sm text-stone-400 hover:bg-stone-800'
              }`}
            >
              {previewPlayerView ? t('encounters.battleMap.previewingPlayerView') : t('encounters.battleMap.previewPlayerView')}
            </button>
          )}
          {isDm && previewPlayerView && (
            <>
              <button
                type="button"
                onClick={() => {
                  requestPreviewSync?.();
                  setPreviewRequestedAt(new Date());
                }}
                title={t('encounters.battleMap.refreshPreviewTitle')}
                className="min-h-11 rounded-md px-3 text-xs bg-stone-900 shadow-sm text-stone-400 hover:bg-stone-800"
              >
                {t('encounters.battleMap.refreshPreview')}
              </button>
              {previewRequestedAt && (
                <span className="text-xs text-stone-500">
                  {t('encounters.battleMap.previewSnapshotCaption', { time: previewRequestedAt.toLocaleTimeString() })}
                </span>
              )}
            </>
          )}
          {canControlSelected && reachableQuery.data && (
            <span className="text-xs text-stone-400 ml-2">
              {t('encounters.battleMap.remainingMovementLabel')}{' '}
              <span className="text-amber-400 font-medium">{formatDistance(reachableQuery.data.remainingFt, user?.unitSystem ?? 'imperial', t)}</span>
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {isDm && (
            <button
              type="button"
              onClick={() => {
                setPaintMode((p) => !p);
                setPendingMove(null);
              }}
              title={t('encounters.battleMap.paintTitle')}
              className={`min-h-11 rounded-md px-3 text-xs ${
                paintMode ? 'bg-amber-950/30 text-amber-400 outline outline-1 outline-amber-600' : 'bg-stone-900 shadow-sm text-stone-400 hover:bg-stone-800'
              }`}
            >
              {paintMode ? t('encounters.battleMap.painting') : t('encounters.battleMap.paintTerrain')}
            </button>
          )}
          {isDm && (
            <button
              type="button"
              onClick={() => {
                setElementEditMode((s) => !s);
                cancelPlacement();
                setSelectedElementId(null);
                setSelectedElementIds(new Set());
                setPendingMove(null);
              }}
              className={`min-h-11 rounded-md px-3 text-xs ${
                elementEditMode ? 'bg-amber-950/30 text-amber-400 outline outline-1 outline-amber-600' : 'bg-stone-900 shadow-sm text-stone-400 hover:bg-stone-800'
              }`}
            >
              {elementEditMode ? t('encounters.mapElements.editingElements') : t('encounters.mapElements.editElements')}
            </button>
          )}
          {isDm && map && (
            <label className="flex items-center gap-1.5 text-xs text-stone-400">
              {t('encounters.battleMap.lightingLabel')}
              <select
                value={map.lightingState}
                onChange={(e) => setLightingMutation.mutate(e.target.value as 'bright' | 'dim' | 'dark')}
                disabled={setLightingMutation.isPending}
                className="rounded-md bg-stone-800 border border-stone-700 px-1.5 py-1 text-xs text-stone-100"
              >
                <option value="bright">{t('encounters.battleMap.lightingBright')}</option>
                <option value="dim">{t('encounters.battleMap.lightingDim')}</option>
                <option value="dark">{t('encounters.battleMap.lightingDark')}</option>
              </select>
            </label>
          )}
          {isDm && (
            <button
              type="button"
              onClick={() => setShowSetup((s) => !s)}
              className="min-h-11 px-2 text-xs text-stone-400 hover:text-stone-200 underline"
            >
              {showSetup ? t('encounters.battleMap.hideMapSettings') : t('encounters.battleMap.reconfigureMap')}
            </button>
          )}
        </div>
      </div>
      {isDm && showSetup && (
        <MapSetupPanel campaignId={campaignId} encounterId={encounterId} map={map} onDone={() => setShowSetup(false)} />
      )}
      {isDm && elementEditMode && (
        <div className="flex flex-shrink-0 flex-wrap items-center gap-2">
          <ElementPalette
            placingType={placingType}
            onSelectType={(type) => {
              setPlacingPoints([]);
              setPlacementHoverCell(null);
              setPlacingType(type);
              setSelectedElementId(null);
            }}
          />
          {placingType && (
            <span className="text-xs text-stone-400">
              {ELEMENT_REGISTRY[placingType].placement === 'point' &&
                t('encounters.mapElements.placeHint', { type: t(ELEMENT_REGISTRY[placingType].labelKey as TranslationKey) })}
              {ELEMENT_REGISTRY[placingType].placement === 'segment' &&
                (placingPoints.length === 0
                  ? t('encounters.mapElements.placeSegmentHintFirst', { type: t(ELEMENT_REGISTRY[placingType].labelKey as TranslationKey) })
                  : t('encounters.mapElements.placeSegmentHintSecond', { type: t(ELEMENT_REGISTRY[placingType].labelKey as TranslationKey) }))}
              {ELEMENT_REGISTRY[placingType].placement === 'polygon' && t('encounters.mapElements.placePolygonHint')}
              {' — '}
              {t('encounters.mapElements.escapeCancelHint')}
            </span>
          )}
          {placingType && ELEMENT_REGISTRY[placingType].placement === 'polygon' && placingPoints.length >= 3 && (
            <Button variant="primary" size="sm" onClick={finishPolygonPlacement}>
              {t('encounters.mapElements.finishShape')}
            </Button>
          )}
          {placingType && (
            <Button variant="ghost" size="sm" onClick={cancelPlacement}>
              {t('encounters.mapElements.cancelPlacement')}
            </Button>
          )}
          {selectedElementIds.size > 1 && (
            <>
              <span className="text-xs text-stone-400">
                {t('encounters.mapElements.selectedCount', { count: String(selectedElementIds.size) })}
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleBulkElementVisibility('revealed_to_players')}
                disabled={setElementsVisibilityBatchMutation.isPending}
              >
                {t('encounters.mapElements.revealSelected')}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleBulkElementVisibility('gm_only')}
                disabled={setElementsVisibilityBatchMutation.isPending}
              >
                {t('encounters.mapElements.hideSelected')}
              </Button>
            </>
          )}
        </div>
      )}

      <div
        ref={containerRef}
        onPointerDown={handleMapPointerDown}
        onPointerMove={handleMapPointerMove}
        onPointerUp={handleMapPointerUp}
        onPointerCancel={handleMapPointerUp}
        // touchAction 'none': the browser's own native touch scroll/pinch
        // would otherwise fight the pointer-event pan/pinch handlers above —
        // this canvas is never natively scrollable (no `overflow-auto`
        // anymore; it always fills 100% of this container, see Target
        // State - Viewport), so nothing native should intercept a touch here.
        // 'grab' by default — the whole canvas is left-drag-pannable now;
        // a nested cell's own `cursor-pointer` (paint/move-target/placement
        // modes) still wins over this per normal CSS cascade since it's set
        // on the more specific (child) element.
        style={{ touchAction: 'none', cursor: 'grab' }}
        className="relative min-h-0 min-w-0 flex-1 overflow-hidden bg-stone-950 shadow-sm sm:rounded-md"
      >
            {/* Single transform is the whole viewport: translate (screen px,
                pan) then scale (zoom) — see geometry.ts's Viewport doc
                comment for why that composition order keeps panX/panY
                zoom-independent. Positioned absolute at the container's
                origin so it's never constrained/sized by mapWidthPx*zoom
                the way the old native-scroll spacer div was. */}
            <div
              className="absolute left-0 top-0 flex"
              // will-change promotes this subtree to its own compositor
              // layer so pan/zoom is a cheap composite instead of a full
              // repaint of everything under the transform (grid, tokens,
              // and — the expensive one — a full-size background image) on
              // every pointermove/wheel tick; without it, panning with a
              // background image loaded visibly jumps/stutters where an
              // empty grid (nothing costly to repaint) does not.
              style={{
                transform: `translate(${viewport.panX}px, ${viewport.panY}px) scale(${viewport.zoom})`,
                transformOrigin: 'top left',
                willChange: 'transform',
              }}
            >
              {/* Row-number column */}
              <div className="flex flex-col flex-shrink-0" style={{ marginTop: 18 }}>
                {Array.from({ length: map.gridRows }, (_, y) => (
                  <div
                    key={y}
                    className="flex items-center justify-end pr-1 text-[10px] text-stone-500 select-none"
                    style={{ height: map.cellSizePx, width: 18 }}
                  >
                    {y + 1}
                  </div>
                ))}
              </div>

              <div>
                {/* Column-letter row */}
                <div className="flex" style={{ height: 18 }}>
                  {Array.from({ length: map.gridColumns }, (_, x) => (
                    <div
                      key={x}
                      className="flex items-center justify-center text-[10px] text-stone-500 select-none"
                      style={{ width: map.cellSizePx }}
                    >
                      {columnLabel(x)}
                    </div>
                  ))}
                </div>

                <div className="relative" style={{ width: mapWidthPx, height: mapHeightPx }}>
                  {map.backgroundFileUrl && (
                    <img
                      src={map.backgroundFileUrl}
                      alt="Battle map background"
                      draggable={false}
                      className="absolute inset-0 h-full w-full object-fill pointer-events-none select-none"
                    />
                  )}

                  {/* Grid-line overlay — CSS grid purely for the visual cell divisions;
                      tokens are positioned separately below via left/top math so their
                      in-drag pixel offset isn't constrained to whole-cell steps. */}
                  <div
                    className="absolute inset-0 grid pointer-events-none"
                    style={{
                      gridTemplateColumns: `repeat(${map.gridColumns}, 1fr)`,
                      gridTemplateRows: `repeat(${map.gridRows}, 1fr)`,
                    }}
                  >
                    {Array.from({ length: map.gridColumns * map.gridRows }, (_, i) => (
                      <div key={i} className="border border-stone-700/40" />
                    ))}
                  </div>

                  {/* Terrain overlay (REFACTOR-PLAN.md §4): shows painted
                      cost_type tints, and — when a participant is selected —
                      the server-computed reachable set. Also doubles as the
                      tap-destination layer for the mobile move flow (tap
                      token to select, tap a cell here to propose a move,
                      confirm in the bar below) when a DM has someone
                      selected and isn't painting terrain. Reachable/terrain
                      shading with neither mode active stays pointer-events-
                      none so it never blocks token dragging underneath. */}
                  <div
                    className={`absolute inset-0 grid ${paintMode || moveTargetMode || placingType ? '' : 'pointer-events-none'}`}
                    style={{
                      gridTemplateColumns: `repeat(${map.gridColumns}, 1fr)`,
                      gridTemplateRows: `repeat(${map.gridRows}, 1fr)`,
                    }}
                    // Hover tracking during placement is computed once here
                    // from the raw pointer position (pointerToVertex), not
                    // per-cell onMouseEnter — a per-cell handler could only
                    // ever report that cell's own fixed index, the same
                    // coarseness bug being fixed for the click itself below.
                    onMouseMove={placingType ? (e) => setPlacementHoverCell(pointerToVertex(e.clientX, e.clientY)) : undefined}
                    onMouseLeave={() => placingType && setPlacementHoverCell(null)}
                  >
                    {Array.from({ length: map.gridRows }, (_, y) =>
                      Array.from({ length: map.gridColumns }, (_, x) => {
                        const override = overridesByCell.get(`${x},${y}`);
                        const isReachable = reachableCells.has(`${x},${y}`);
                        const isSpentMovement = !isReachable && spentMovementCells.has(`${x},${y}`);
                        const isPending = pendingMove?.x === x && pendingMove?.y === y;
                        return (
                          <div
                            key={`${x},${y}`}
                            onClick={
                              placingType || paintMode || moveTargetMode ? (e) => handleCellClick(x, y, e) : undefined
                            }
                            title={
                              placingType
                                ? cellLabel(x, y)
                                : paintMode
                                  ? t('encounters.battleMap.cellPaintTitle', { cell: cellLabel(x, y) })
                                  : moveTargetMode
                                    ? t(selectedIsUnplaced ? 'encounters.battleMap.placeHere' : 'encounters.battleMap.moveHere', {
                                        cell: cellLabel(x, y),
                                      })
                                    : (override?.note ?? undefined)
                            }
                            // Legible over any background (dark map, light map, or a
                            // detailed image): a semi-transparent fill alone (the old
                            // bg-emerald-600/15) all but disappears over busy art, so
                            // reachable cells also get a solid, high-contrast outline.
                            // spentMovementCells (this turn's full-speed footprint minus
                            // what's still reachable) get a distinct muted/dashed
                            // treatment — "you could reach here on a fresh turn, not
                            // anymore" — instead of just silently not being highlighted.
                            className={`${paintMode || moveTargetMode || placingType ? 'cursor-pointer hover:outline hover:outline-1 hover:outline-amber-500' : ''} ${
                              override ? OVERRIDE_TINT[override.cost_type] : ''
                            } ${
                              isReachable && !override
                                ? 'bg-emerald-500/25 outline outline-1 -outline-offset-1 outline-emerald-400'
                                : ''
                            } ${
                              isSpentMovement && !override
                                ? 'bg-rose-900/20 outline outline-1 outline-dashed -outline-offset-1 outline-rose-500/60'
                                : ''
                            } ${
                              isPending ? 'outline outline-2 -outline-offset-1 outline-amber-400 bg-amber-500/25' : ''
                            }`}
                          />
                        );
                      }),
                    )}
                  </div>

                  {/* Precise vertex markers for an in-progress placement —
                      already-placed points (segment start / polygon
                      vertices) plus the live snapped point under the
                      cursor, at the exact vertex pointerToVertex computed
                      (not a whole-cell tint, which can't represent a
                      vertex — the outer grid boundary in particular has no
                      containing cell of its own). This is the "visual
                      feedback of the anchor point before release." */}
                  {placingType &&
                    placingPoints.map((pt, i) => (
                      <div
                        key={i}
                        className="pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-sky-400 ring-2 ring-sky-200"
                        style={{ left: pt.x * map.cellSizePx, top: pt.y * map.cellSizePx }}
                      />
                    ))}
                  {placingType && placementHoverCell && (
                    <div
                      className="pointer-events-none absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-amber-400 bg-amber-400/30"
                      style={{ left: placementHoverCell.x * map.cellSizePx, top: placementHoverCell.y * map.cellSizePx }}
                    />
                  )}

                  <MapCanvasElements
                    elements={canvasMapElements}
                    isDm={canvasIsDm}
                    cellSizePx={map.cellSizePx}
                    selectedElementId={selectedElementId}
                    onSelect={handleElementClick}
                    resolveAssetUrl={resolveAssetUrl}
                  />

                  {placementPreviewElement && (
                    <div className="pointer-events-none opacity-60 outline-dashed">
                      {renderMapElement(placementPreviewElement, {
                        cellSizePx: map.cellSizePx,
                        isSelected: false,
                        onSelect: () => {},
                        resolveAssetUrl,
                      })}
                    </div>
                  )}

                  {previewPlaced.map((p) => (
                    <Token
                      key={p.participantId}
                      participant={p}
                      cellSizePx={map.cellSizePx}
                      gridColumns={map.gridColumns}
                      gridRows={map.gridRows}
                      zoom={viewport.zoom}
                      isActive={p.participantId === activeParticipantId}
                      isDraggable={!previewActive && canControl(p) && !spacePressed}
                      isSelected={p.participantId === selectedId}
                      isMultiSelected={multiSelectedIds.has(p.participantId)}
                      controlBadge={controlBadgeFor(p.characterId, characters, user?.id)}
                      feetPerCell={map.feetPerCell}
                      diagonalRule={campaign.diagonal_movement_rule}
                      snapToGrid={snapToGrid}
                      onMove={(x, y) => handleTokenMove(p, x, y)}
                      onSelect={(e) => handleTokenClick(p.participantId, e)}
                      // Single click only selects (for move-targeting) —
                      // opening the stats sheet on every click made
                      // repositioning several tokens in a row annoying
                      // (a sheet kept popping open). Double click opens it.
                      onOpenSheet={() => onOpenSheet?.(p.participantId)}
                    />
                  ))}

                  <VisionOverlay
                    participants={canvasParticipants}
                    mapElements={canvasMapElements}
                    cellSizePx={map.cellSizePx}
                    feetPerCell={map.feetPerCell}
                    mapWidthPx={mapWidthPx}
                    mapHeightPx={mapHeightPx}
                    active={(!isDm || previewPlayerView) && map.lightingState === 'dark'}
                  />

                  {/* Per-map lighting (nav point 4) — a flat, non-blocking
                      tint distinct from VisionOverlay's opaque fog mask
                      above (dim never masks, only tints). Applied for every
                      viewer including the DM's own default view — "GM
                      always sees the unmasked map" is read here as
                      specifically about the opaque fog mask (bright/dark),
                      not this cosmetic mood tint, which a DM would
                      plausibly want to preview too; flip this condition to
                      also require `!isDm || previewPlayerView` if a fully
                      neutral DM screen was actually intended. */}
                  {map.lightingState === 'dim' && (
                    <div
                      className="absolute inset-0 pointer-events-none bg-slate-950/25"
                      style={{ width: mapWidthPx, height: mapHeightPx }}
                    />
                  )}
                </div>
              </div>
            </div>

            {/* Live Map turn overlay — a sibling of the pan/zoom transform
                div above, not a child of it, so its screen position stays
                fixed to this container's corner regardless of pan/zoom.
                DM-only (every action it exposes requires the DM role
                server-side); a player's initiative order is still always
                visible in SessionScreen's sticky strip above the map. */}
            {isDm && rollInitiativeMutation && advanceTurnMutation && previousTurnMutation && (
              <TurnControlOverlay
                mode={encounter.mode}
                participants={participants}
                activeParticipantId={activeParticipantId}
                characters={characters}
                myUserId={user?.id}
                onSelect={onOpenSheet}
                rollInitiativeMutation={rollInitiativeMutation}
                advanceTurnMutation={advanceTurnMutation}
                previousTurnMutation={previousTurnMutation}
              />
            )}
        </div>

      {/* Exact-coordinates input — a third path to the same pendingMove/
          confirm flow as a map click or a drag drop (Target State: "also by
          entering exact coordinates"). Shown any time a controllable token
          is selected, placed or not, so it covers both initial placement and
          repositioning with one control. */}
      {moveTargetMode && selectedParticipant && (
        <div className="flex-shrink-0 rounded-md bg-stone-900 shadow-sm p-3 flex flex-wrap items-end gap-3">
          <p className="text-xs text-stone-500">
            {t('encounters.battleMap.coordinatesHint', { name: selectedParticipant.name })}
          </p>
          <Field label={t('encounters.battleMap.coordColumn')} htmlFor="battle-map-coord-x" className="w-20">
            <Input
              id="battle-map-coord-x"
              type="number"
              min={0}
              max={map.gridColumns - 1}
              value={coordInput.x}
              onChange={(e) => setCoordInput((prev) => ({ ...prev, x: e.target.value }))}
            />
          </Field>
          <Field label={t('encounters.battleMap.coordRow')} htmlFor="battle-map-coord-y" className="w-20">
            <Input
              id="battle-map-coord-y"
              type="number"
              min={0}
              max={map.gridRows - 1}
              value={coordInput.y}
              onChange={(e) => setCoordInput((prev) => ({ ...prev, y: e.target.value }))}
            />
          </Field>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={coordInput.x === '' || coordInput.y === ''}
            onClick={() => {
              const x = clamp(Number(coordInput.x), 0, map.gridColumns - 1);
              const y = clamp(Number(coordInput.y), 0, map.gridRows - 1);
              setPendingMove({ x, y });
            }}
          >
            {t('encounters.battleMap.goToCoordinates')}
          </Button>
        </div>
      )}

      {/* Tap-to-move confirm bar (docs/design-tokens.md mobile pass) — a
          sticky bottom bar rather than inline, so it stays reachable without
          scrolling back up on a tall mobile layout, with an equally-obvious
          Cancel next to Confirm. */}
      {pendingMove && selectedParticipant && (
        <div className="sticky bottom-0 z-40 flex flex-shrink-0 flex-wrap items-center justify-between gap-3 rounded-md bg-stone-900 p-3 shadow-lg pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <div className="text-sm">
            <span className="text-stone-100 font-medium">{selectedParticipant.name}</span>
            <span className="text-stone-400"> → {cellLabel(pendingMove.x, pendingMove.y)}</span>
            {!pendingMoveIsReachable && (
              <span className="ml-2 text-xs text-amber-400">{t('encounters.battleMap.outsideMovement')}</span>
            )}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setPendingMove(null)}
              className="min-h-11 rounded-md border border-stone-600 px-4 text-sm text-stone-200 hover:bg-stone-100/5"
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              disabled={positionMutation.isPending}
              onClick={() =>
                positionMutation.mutate({ participantId: selectedParticipant.participantId, x: pendingMove.x, y: pendingMove.y })
              }
              className="min-h-11 rounded-md border border-amber-500 px-4 text-sm font-semibold text-amber-500 hover:bg-amber-500/10 disabled:opacity-45"
            >
              {positionMutation.isPending
                ? t('encounters.battleMap.moving')
                : selectedIsUnplaced
                  ? t('encounters.battleMap.confirmPlacement')
                  : t('encounters.battleMap.confirmMove')}
            </button>
          </div>
        </div>
      )}

      {/* Initial placement (from null,null) is always a free move server-side
          regardless of mode/turn (computeValidatedMoveCost), so the gate
          here is plain ownership — DM places anyone, a player places their
          own unplaced character. Selecting a name here no longer drops it
          sight-unseen at the top-left corner — it enters the same
          select-then-target flow as repositioning an already-placed token
          (click the destination cell, drag isn't available yet since there's
          no token on the map to drag from, or type exact coordinates above),
          so the DM picks the real destination in one step instead of
          place-then-drag. */}
      {unplacedControllable.length > 0 && (
        <div className="flex-shrink-0 rounded-md bg-stone-900 shadow-sm p-3">
          <p className="text-xs text-stone-500 mb-2">{t('encounters.battleMap.unplacedHint')}</p>
          <div className="flex flex-wrap gap-2">
            {unplacedControllable.map((p) => (
              <button
                key={p.participantId}
                type="button"
                onClick={() => selectParticipant(selectedId === p.participantId ? null : p.participantId)}
                className={`min-h-11 rounded-md px-3 text-xs text-stone-200 ${
                  selectedId === p.participantId
                    ? 'bg-amber-500/20 outline outline-2 outline-amber-400'
                    : 'bg-stone-800 hover:bg-stone-700'
                }`}
              >
                {p.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {isDm && selectedElement && (
        <ElementPropertyPanel campaignId={campaignId} encounterId={encounterId} element={selectedElement} onClose={() => setSelectedElementId(null)} />
      )}

      {!isDm && selectedElement?.type === 'door' && (
        <DoorActionPanel
          encounterId={encounterId}
          element={selectedElement}
          participants={participants}
          myCharacterIds={myCharacterIds}
          onClose={() => setSelectedElementId(null)}
        />
      )}
    </div>
  );
}

// DM-only grid/background configuration. Inline panel (not a modal/route) so
// it stays mounted alongside the same useEncounterLive subscription as the
// rest of CombatTracker. Upload-new-or-pick-existing pattern copied from
// CreatureEditorPage.tsx's "Art" section — same GET /campaigns/:id/assets
// query, same ImageUploadField wiring, same client-side asset_type filter.
function MapSetupPanel({
  campaignId,
  encounterId,
  map,
  onDone,
}: {
  campaignId: string;
  encounterId: string;
  map: MapConfig | null;
  onDone: () => void;
}) {
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const [gridColumns, setGridColumns] = useState(map?.gridColumns ?? 20);
  const [gridRows, setGridRows] = useState(map?.gridRows ?? 20);
  const [cellSizePx, setCellSizePx] = useState(map?.cellSizePx ?? 50);
  const [feetPerCell, setFeetPerCell] = useState(map?.feetPerCell ?? 5);
  const [backgroundAssetId, setBackgroundAssetId] = useState<string | null>(map?.backgroundAssetId ?? null);

  const assetsQuery = useQuery({
    queryKey: ['campaign', campaignId, 'assets'],
    queryFn: () => api.get<{ assets: CampaignAsset[] }>(`/campaigns/${campaignId}/assets`),
  });

  function handleAssetUploaded(asset: CampaignAsset) {
    queryClient.setQueryData<{ assets: CampaignAsset[] }>(['campaign', campaignId, 'assets'], (prev) =>
      prev ? { assets: [asset, ...prev.assets.filter((a) => a.id !== asset.id)] } : { assets: [asset] },
    );
    setBackgroundAssetId(asset.id);
  }

  const saveMutation = useMutation({
    mutationFn: () => api.put(`/encounters/${encounterId}/map`, { backgroundAssetId, gridColumns, gridRows, cellSizePx, feetPerCell }),
    // No cache write here either — MAP_UPDATED over the socket patches
    // useEncounterLive's cache (including for the DM's own change).
    onSuccess: onDone,
  });

  const selectedAsset = assetsQuery.data?.assets.find((a) => a.id === backgroundAssetId);

  return (
    <div className="rounded-md bg-stone-900 shadow-sm p-4 space-y-4">
      <h3 className="text-xs uppercase text-stone-500">{t('encounters.battleMap.mapSettings')}</h3>

      {saveMutation.isError && <ErrorBanner message={errorMessage(saveMutation.error)} />}

      <div className="flex flex-wrap gap-4">
        <Field label={t('encounters.battleMap.columns')} htmlFor="mapCols" className="w-24">
          <Input
            id="mapCols"
            type="number"
            min={GRID_MIN}
            max={GRID_MAX}
            value={gridColumns}
            onChange={(e) => setGridColumns(clamp(Number(e.target.value), GRID_MIN, GRID_MAX))}
          />
        </Field>
        <Field label={t('encounters.battleMap.rows')} htmlFor="mapRows" className="w-24">
          <Input
            id="mapRows"
            type="number"
            min={GRID_MIN}
            max={GRID_MAX}
            value={gridRows}
            onChange={(e) => setGridRows(clamp(Number(e.target.value), GRID_MIN, GRID_MAX))}
          />
        </Field>
        <Field label={t('encounters.battleMap.cellSize')} htmlFor="mapCellSize" className="w-28">
          <Input
            id="mapCellSize"
            type="number"
            min={CELL_SIZE_MIN}
            max={CELL_SIZE_MAX}
            value={cellSizePx}
            onChange={(e) => setCellSizePx(clamp(Number(e.target.value), CELL_SIZE_MIN, CELL_SIZE_MAX))}
          />
        </Field>
        <Field label={t('encounters.battleMap.feetPerCell')} htmlFor="mapFeetPerCell" className="w-28">
          <Input
            id="mapFeetPerCell"
            type="number"
            min={1}
            max={50}
            value={feetPerCell}
            onChange={(e) => setFeetPerCell(clamp(Number(e.target.value), 1, 50))}
          />
        </Field>
      </div>

      <div>
        <p className="text-xs text-stone-500 mb-2">{t('encounters.battleMap.backgroundImage')}</p>
        <div className="flex items-center gap-3">
          <Portrait fileUrl={selectedAsset?.file_url} alt="Map background" size="lg" placeholderLabel={t('encounters.battleMap.backgroundPlaceholder')} />
          <div className="flex flex-col gap-2">
            <ImageUploadField campaignId={campaignId} onUploaded={handleAssetUploaded} label={t('encounters.battleMap.uploadNewImage')} />
            {backgroundAssetId !== null && (
              <button
                type="button"
                onClick={() => setBackgroundAssetId(null)}
                className="text-xs text-stone-400 hover:text-stone-200 text-left"
              >
                {t('encounters.battleMap.clearBackground')}
              </button>
            )}
          </div>
        </div>
        {assetsQuery.data && assetsQuery.data.assets.length > 0 && (
          <div className="mt-3">
            <p className="text-[10px] text-stone-500 mb-1.5">{t('encounters.battleMap.pickExistingAsset')}</p>
            <div className="flex flex-wrap gap-2">
              {assetsQuery.data.assets
                .filter((a) => a.asset_type === 'image')
                .map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => setBackgroundAssetId(a.id)}
                    className={`rounded-md ${backgroundAssetId === a.id ? 'ring-2 ring-amber-500' : ''}`}
                    aria-label={t('encounters.battleMap.selectAsBackground', { title: a.title ?? 'asset' })}
                  >
                    <Portrait fileUrl={a.file_url} alt={a.title ?? 'Campaign asset'} size="sm" />
                  </button>
                ))}
            </div>
          </div>
        )}
      </div>

      <div className="flex gap-2">
        <Button variant="primary" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
          {saveMutation.isPending ? t('encounters.battleMap.saving') : t('encounters.battleMap.saveMapSettings')}
        </Button>
        {map && (
          <button type="button" onClick={onDone} className="min-h-11 text-sm text-stone-400 hover:text-stone-200 px-3">
            {t('common.cancel')}
          </button>
        )}
      </div>
    </div>
  );
}

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
import type { Character, EncounterMode, EncounterStatus, CampaignAsset, SnapshotParticipant } from '../lib/types';
import type { MapConfig } from '../lib/socketTypes';
import { Portrait } from '../components/Portrait';
import { ImageUploadField } from '../components/ImageUploadField';
import { ErrorBanner, EmptyState, errorMessage } from '../components/Feedback';
import { Field, Input } from '../components/ui/Field';
import { Button } from '../components/ui/Button';
import { useAuth } from '../auth/AuthContext';
import { useLocale } from '../i18n/LocaleContext';
import { canMoveToken } from './canMoveToken';
import { Token } from './Token';
import { controlBadgeFor } from './controlBadge';

const GRID_MIN = 5;
const GRID_MAX = 50;
const CELL_SIZE_MIN = 20;
const CELL_SIZE_MAX = 150;
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 2;
const ZOOM_STEP = 0.25;

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
  activeParticipantId,
  encounter,
  isDm,
  myCharacterIds = new Set(),
  characters,
  onOpenSheet,
}: {
  encounterId: string;
  campaignId: string;
  map: MapConfig | null;
  participants: SnapshotParticipant[];
  activeParticipantId: string | null;
  /** mode/status/currentTurnIndex — enough for canMoveToken.ts's client-side
   * enable/disable mirror of the server's move-validation decision. */
  encounter: { mode: EncounterMode; status: EncounterStatus; currentTurnIndex: number };
  isDm: boolean;
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
}) {
  const { t } = useLocale();
  const { user } = useAuth();
  const [showSetup, setShowSetup] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [paintMode, setPaintMode] = useState(false);
  // Tap-to-move (docs/design-tokens.md mobile pass): "dragging is unreliable
  // with a finger covering the target — tap to select, then tap-destination,
  // then an explicit confirm control ... with an obvious cancel." Additive,
  // not a replacement for drag — a DM can still drag on desktop; this is a
  // second path to the same positionMutation below, for when a finger is in
  // the way of precise dragging.
  const [pendingMove, setPendingMove] = useState<{ x: number; y: number } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();

  // Pinch-to-zoom (docs/design-tokens.md mobile pass: "pinch to zoom and
  // drag to pan must feel native"). Tracked with raw Pointer Events (same
  // primitive Token.tsx's drag already uses) rather than a gesture library —
  // two concurrent pointers on the map area scale `zoom` from the distance
  // between them; a single pointer is left alone so native one-finger
  // scroll-panning (the container's own `overflow-auto`) keeps working
  // untouched. `touch-action: pan-x pan-y` on the container (below) hands
  // pinch gestures to this handler instead of the browser's page zoom,
  // without disabling native single-finger panning.
  const activePointers = useRef(new Map<number, { x: number; y: number }>());
  const pinchStart = useRef<{ distance: number; zoom: number } | null>(null);

  function pointerDistance(): number | null {
    const pts = [...activePointers.current.values()];
    if (pts.length < 2) return null;
    const [a, b] = pts;
    return Math.hypot(a!.x - b!.x, a!.y - b!.y);
  }

  function handleMapPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    activePointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const distance = pointerDistance();
    if (distance != null) pinchStart.current = { distance, zoom };
  }

  function handleMapPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (!activePointers.current.has(e.pointerId)) return;
    activePointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (!pinchStart.current) return;
    const distance = pointerDistance();
    if (distance == null || pinchStart.current.distance === 0) return;
    userZoomedRef.current = true;
    setZoom(clamp10(pinchStart.current.zoom * (distance / pinchStart.current.distance)));
  }

  function handleMapPointerUp(e: ReactPointerEvent<HTMLDivElement>) {
    activePointers.current.delete(e.pointerId);
    if (activePointers.current.size < 2) pinchStart.current = null;
  }

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
  const reachableQuery = useQuery({
    queryKey: ['encounter', encounterId, 'reachable', selectedId],
    queryFn: () => api.get<{ cells: string[]; remainingFt: number }>(`/encounters/${encounterId}/participants/${selectedId}/reachable`),
    enabled: canControlSelected,
  });
  const reachableCells = new Set(reachableQuery.data?.cells ?? []);
  const moveTargetMode = !paintMode && selectedParticipant != null && canControl(selectedParticipant);
  const pendingMoveIsReachable = pendingMove != null && (reachableCells.size === 0 || reachableCells.has(`${pendingMove.x},${pendingMove.y}`));

  // REFACTOR-PLAN.md §1: "on map load, spawn the creature instances assigned
  // to that map only if alive." Character participants (monsterInstanceStatus
  // null) are unaffected; a dead/fled/captured monster instance stays in the
  // initiative roster but never renders a token, placed or not.
  const spawnable = participants.filter((p) => p.monsterInstanceStatus === null || p.monsterInstanceStatus === 'alive');
  const placed = spawnable.filter((p) => p.posX != null && p.posY != null);
  const unplaced = spawnable.filter((p) => p.posX == null || p.posY == null);
  const unplacedControllable = unplaced.filter((p) => isDm || isOwnToken(p));

  function selectParticipant(id: string | null) {
    setSelectedId(id);
    setPendingMove(null);
  }

  function centerOnActive() {
    const container = scrollRef.current;
    if (!container || !map || activeParticipantId == null) return;
    const active = placed.find((p) => p.participantId === activeParticipantId);
    if (!active || active.posX == null || active.posY == null) return;
    const centerX = (active.posX + 0.5) * map.cellSizePx * zoom;
    const centerY = (active.posY + 0.5) * map.cellSizePx * zoom;
    container.scrollTo({
      left: centerX - container.clientWidth / 2,
      top: centerY - container.clientHeight / 2,
      behavior: 'smooth',
    });
  }

  const mapWidthPx = map ? map.gridColumns * map.cellSizePx : 0;
  const mapHeightPx = map ? map.gridRows * map.cellSizePx : 0;

  // Fit-to-container zoom: the grid otherwise renders at its literal
  // gridColumns*cellSizePx pixel size regardless of how much room the
  // surrounding page gives it, leaving a large dead/empty strip in the
  // scrollable container whenever the map is smaller than the viewport
  // (reported directly against both the fullscreen live map and the new Map
  // section). `userZoomedRef` stops this from fighting a zoom the user set
  // on purpose — the zoom +/- buttons and pinch handler below all set it,
  // and Reset clears it so the map goes back to auto-fitting on the next
  // resize instead of pinning a fixed percentage.
  //
  // Applied directly from the ResizeObserver callback rather than via a
  // second effect keyed on a `containerSize` state value — that two-step
  // version lost its very first fit under React StrictMode's dev-only
  // mount→cleanup→mount cycle (the first observer's initial notification
  // landed after its own disconnect(), so only a later resize would have
  // ever triggered it — confirmed live: the map sat at 100% until a manual
  // Reset click, which computes the same formula synchronously and worked
  // immediately). One callback, no intermediate render needed to apply it.
  const userZoomedRef = useRef(false);

  function fitZoomFor(width: number, height: number): number {
    if (mapWidthPx <= 0 || mapHeightPx <= 0) return 1;
    // max, not min: a "contain" fit (min of both ratios) shrinks a
    // roughly-square map down to whichever dimension is more restrictive —
    // for a square grid inside a short-and-wide viewport that's the height,
    // which left the exact large dead strip on the sides this was meant to
    // remove. max fills the container on at least one axis (usually width,
    // for the common short-and-wide case), scrolling for whatever overflows
    // the other axis — panning a map that's bigger than the viewport is
    // already a normal, supported interaction here (drag-to-pan, zoom
    // controls, center-on-active), unlike leaving most of the screen empty.
    return clamp10(Math.max(width / mapWidthPx, height / mapHeightPx));
  }

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry || userZoomedRef.current) return;
      setZoom(fitZoomFor(entry.contentRect.width, entry.contentRect.height));
    });
    observer.observe(el);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapWidthPx, mapHeightPx]);

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

      <div className="flex flex-shrink-0 items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-1 flex-wrap">
          <button
            type="button"
            onClick={() => {
              userZoomedRef.current = true;
              setZoom((z) => clamp10(z - ZOOM_STEP));
            }}
            disabled={zoom <= ZOOM_MIN}
            aria-label={t('encounters.battleMap.zoomOut')}
            className="min-h-11 min-w-11 rounded-md bg-stone-900 shadow-sm text-sm text-stone-300 hover:bg-stone-800 disabled:opacity-40"
          >
            −
          </button>
          <span className="text-xs text-stone-400 w-12 text-center">{Math.round(zoom * 100)}%</span>
          <button
            type="button"
            onClick={() => {
              userZoomedRef.current = true;
              setZoom((z) => clamp10(z + ZOOM_STEP));
            }}
            disabled={zoom >= ZOOM_MAX}
            aria-label={t('encounters.battleMap.zoomIn')}
            className="min-h-11 min-w-11 rounded-md bg-stone-900 shadow-sm text-sm text-stone-300 hover:bg-stone-800 disabled:opacity-40"
          >
            +
          </button>
          <button
            type="button"
            onClick={() => {
              // "Reset" means "fit the map to the screen" now, not a literal
              // 100% — clearing the ref lets the effect above keep it fitted
              // through future container resizes too, instead of pinning a
              // manual zoom the user didn't ask to keep.
              userZoomedRef.current = false;
              const el = scrollRef.current;
              setZoom(el ? fitZoomFor(el.clientWidth, el.clientHeight) : 1);
            }}
            className="min-h-11 rounded-md bg-stone-900 shadow-sm px-3 text-xs text-stone-400 hover:bg-stone-800"
          >
            {t('encounters.battleMap.reset')}
          </button>
          <button
            type="button"
            onClick={centerOnActive}
            disabled={activeParticipantId == null}
            className="min-h-11 rounded-md bg-stone-900 shadow-sm px-3 text-xs text-stone-400 hover:bg-stone-800 disabled:opacity-40"
          >
            {t('encounters.battleMap.centerOnActive')}
          </button>
          {canControlSelected && reachableQuery.data && (
            <span className="text-xs text-stone-400 ml-2">
              {t('encounters.battleMap.remainingMovementLabel')}{' '}
              <span className="text-amber-400 font-medium">{t('encounters.tracker.feetValue', { value: reachableQuery.data.remainingFt })}</span>
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

      <div
        ref={scrollRef}
        onPointerDown={handleMapPointerDown}
        onPointerMove={handleMapPointerMove}
        onPointerUp={handleMapPointerUp}
        onPointerCancel={handleMapPointerUp}
        style={{ touchAction: 'pan-x pan-y' }}
        className="min-h-0 min-w-0 flex-1 overflow-auto bg-stone-950 shadow-sm p-1.5 sm:rounded-md sm:p-3 overscroll-contain"
      >
          <div style={{ width: mapWidthPx * zoom, height: mapHeightPx * zoom }}>
            <div className="flex" style={{ transform: `scale(${zoom})`, transformOrigin: 'top left' }}>
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
                    className={`absolute inset-0 grid ${paintMode || moveTargetMode ? '' : 'pointer-events-none'}`}
                    style={{
                      gridTemplateColumns: `repeat(${map.gridColumns}, 1fr)`,
                      gridTemplateRows: `repeat(${map.gridRows}, 1fr)`,
                    }}
                  >
                    {Array.from({ length: map.gridRows }, (_, y) =>
                      Array.from({ length: map.gridColumns }, (_, x) => {
                        const override = overridesByCell.get(`${x},${y}`);
                        const isReachable = reachableCells.has(`${x},${y}`);
                        const isPending = pendingMove?.x === x && pendingMove?.y === y;
                        return (
                          <div
                            key={`${x},${y}`}
                            onClick={
                              paintMode
                                ? () => handleCellPaint(x, y)
                                : moveTargetMode
                                  ? () => setPendingMove({ x, y })
                                  : undefined
                            }
                            title={
                              paintMode
                                ? t('encounters.battleMap.cellPaintTitle', { cell: cellLabel(x, y) })
                                : moveTargetMode
                                  ? t('encounters.battleMap.moveHere', { cell: cellLabel(x, y) })
                                  : (override?.note ?? undefined)
                            }
                            className={`${paintMode || moveTargetMode ? 'cursor-pointer hover:outline hover:outline-1 hover:outline-amber-500' : ''} ${
                              override ? OVERRIDE_TINT[override.cost_type] : ''
                            } ${isReachable && !override ? 'bg-emerald-600/15' : ''} ${
                              isPending ? 'outline outline-2 outline-amber-400 bg-amber-500/25' : ''
                            }`}
                          />
                        );
                      }),
                    )}
                  </div>

                  {placed.map((p) => (
                    <Token
                      key={p.participantId}
                      participant={p}
                      cellSizePx={map.cellSizePx}
                      gridColumns={map.gridColumns}
                      gridRows={map.gridRows}
                      zoom={zoom}
                      isActive={p.participantId === activeParticipantId}
                      isDraggable={canControl(p)}
                      isSelected={p.participantId === selectedId}
                      controlBadge={controlBadgeFor(p.characterId, characters, user?.id)}
                      onMove={(x, y) => positionMutation.mutate({ participantId: p.participantId, x, y })}
                      onSelect={() => selectParticipant(selectedId === p.participantId ? null : p.participantId)}
                      // Single click only selects (for move-targeting) —
                      // opening the stats sheet on every click made
                      // repositioning several tokens in a row annoying
                      // (a sheet kept popping open). Double click opens it.
                      onOpenSheet={() => onOpenSheet?.(p.participantId)}
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

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
              {positionMutation.isPending ? t('encounters.battleMap.moving') : t('encounters.battleMap.confirmMove')}
            </button>
          </div>
        </div>
      )}

      {/* Initial placement (from null,null) is always a free move server-side
          regardless of mode/turn (computeValidatedMoveCost), so the gate
          here is plain ownership — DM places anyone, a player places their
          own unplaced character. */}
      {unplacedControllable.length > 0 && (
        <div className="flex-shrink-0 rounded-md bg-stone-900 shadow-sm p-3">
          <p className="text-xs text-stone-500 mb-2">{t('encounters.battleMap.unplacedHint')}</p>
          <div className="flex flex-wrap gap-2">
            {unplacedControllable.map((p) => (
              <button
                key={p.participantId}
                type="button"
                disabled={positionMutation.isPending}
                onClick={() => positionMutation.mutate({ participantId: p.participantId, x: 0, y: 0 })}
                className="min-h-11 rounded-md bg-stone-800 hover:bg-stone-700 px-3 text-xs text-stone-200 disabled:opacity-60"
              >
                {p.name}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function clamp10(n: number): number {
  // Avoids float drift (0.1 + 0.2 !== 0.3) from repeated +/- ZOOM_STEP clicks.
  return Math.round(clamp(Math.round(n * 100), ZOOM_MIN * 100, ZOOM_MAX * 100)) / 100;
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

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
// for authoring map_cell_overrides. Movement is still DM-only end to end
// today (the position PATCH route stays requireEncounterDm-gated), so the
// reachable/paint UI below only activates for the DM.

import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { CampaignAsset, SnapshotParticipant } from '../lib/types';
import { isExactHp } from '../lib/types';
import type { MapConfig } from '../lib/socketTypes';
import { Portrait } from '../components/Portrait';
import { ImageUploadField } from '../components/ImageUploadField';
import { ErrorBanner, EmptyState, errorMessage } from '../components/Feedback';
import { Token } from './Token';

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

const FACTION_OPTIONS: Array<{ value: SnapshotParticipant['faction']; label: string }> = [
  { value: 'player', label: 'Player' },
  { value: 'ally', label: 'Ally' },
  { value: 'enemy', label: 'Enemy' },
  { value: 'neutral', label: 'Neutral' },
];

export function BattleMap({
  encounterId,
  campaignId,
  map,
  participants,
  activeParticipantId,
  isDm,
  showRoster = true,
}: {
  encounterId: number;
  campaignId: number;
  map: MapConfig | null;
  participants: SnapshotParticipant[];
  activeParticipantId: number | null;
  isDm: boolean;
  /** BattleMode.tsx already renders its own DM/player side panel (HP,
   * effects, dice — action-oriented tools) alongside this component, so it
   * turns this off to avoid two participant lists competing for the same
   * strip of screen; the standalone /maps/:mapId route (which has no other
   * side panel) leaves it on. Known gap either way: BattleMode's own panels
   * don't show coordinates or two-way hover-sync with the map — only this
   * panel does. */
  showRoster?: boolean;
}) {
  const [showSetup, setShowSetup] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [zoom, setZoom] = useState(1);
  const [paintMode, setPaintMode] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();

  const positionMutation = useMutation({
    mutationFn: ({ participantId, x, y }: { participantId: number; x: number | null; y: number | null }) =>
      api.patch(`/encounters/${encounterId}/participants/${participantId}/position`, { x, y }),
    // No cache write on success, on purpose: TOKEN_MOVED arriving over the
    // socket (which the DM's own action also triggers) is the single source
    // of truth for token position, same discipline as CombatTracker's
    // hpMutation/applyEffectMutation.
  });

  const factionMutation = useMutation({
    mutationFn: ({ participantId, faction }: { participantId: number; faction: SnapshotParticipant['faction'] }) =>
      api.patch(`/encounters/${encounterId}/participants/${participantId}/faction`, { faction }),
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

  // REFACTOR-PLAN.md §4: "selecting a character highlights reachable cells
  // based on remaining speed, computed with pathfinding over actual terrain
  // cost." Server-computed (never re-derived client-side) — see
  // docs/rules/movement.md.
  const reachableQuery = useQuery({
    queryKey: ['encounter', encounterId, 'reachable', selectedId],
    queryFn: () => api.get<{ cells: string[]; remainingFt: number }>(`/encounters/${encounterId}/participants/${selectedId}/reachable`),
    enabled: isDm && selectedId != null,
  });
  const reachableCells = new Set(reachableQuery.data?.cells ?? []);

  // REFACTOR-PLAN.md §1: "on map load, spawn the creature instances assigned
  // to that map only if alive." Character participants (monsterInstanceStatus
  // null) are unaffected; a dead/fled/captured monster instance stays in the
  // initiative roster but never renders a token, placed or not.
  const spawnable = participants.filter((p) => p.monsterInstanceStatus === null || p.monsterInstanceStatus === 'alive');
  const placed = spawnable.filter((p) => p.posX != null && p.posY != null);
  const unplaced = spawnable.filter((p) => p.posX == null || p.posY == null);

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

  if (!map) {
    return (
      <div className="space-y-4">
        {isDm ? (
          <>
            <EmptyState message="No map configured for this encounter yet." />
            <MapSetupPanel campaignId={campaignId} encounterId={encounterId} map={null} onDone={() => {}} />
          </>
        ) : (
          <EmptyState message="The DM hasn't set up a map yet." />
        )}
      </div>
    );
  }

  const mapWidthPx = map.gridColumns * map.cellSizePx;
  const mapHeightPx = map.gridRows * map.cellSizePx;

  return (
    <div className="space-y-4">
      {positionMutation.isError && <ErrorBanner message={errorMessage(positionMutation.error)} />}
      {factionMutation.isError && <ErrorBanner message={errorMessage(factionMutation.error)} />}

      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setZoom((z) => clamp10(z - ZOOM_STEP))}
            disabled={zoom <= ZOOM_MIN}
            aria-label="Zoom out"
            className="rounded-md border border-stone-700 bg-stone-900 px-2 py-1 text-sm text-stone-300 hover:bg-stone-800 disabled:opacity-40"
          >
            −
          </button>
          <span className="text-xs text-stone-400 w-12 text-center">{Math.round(zoom * 100)}%</span>
          <button
            type="button"
            onClick={() => setZoom((z) => clamp10(z + ZOOM_STEP))}
            disabled={zoom >= ZOOM_MAX}
            aria-label="Zoom in"
            className="rounded-md border border-stone-700 bg-stone-900 px-2 py-1 text-sm text-stone-300 hover:bg-stone-800 disabled:opacity-40"
          >
            +
          </button>
          <button
            type="button"
            onClick={() => setZoom(1)}
            className="rounded-md border border-stone-700 bg-stone-900 px-2 py-1 text-xs text-stone-400 hover:bg-stone-800"
          >
            Reset
          </button>
          <button
            type="button"
            onClick={centerOnActive}
            disabled={activeParticipantId == null}
            className="rounded-md border border-stone-700 bg-stone-900 px-2 py-1 text-xs text-stone-400 hover:bg-stone-800 disabled:opacity-40"
          >
            Center on active
          </button>
          {isDm && selectedId != null && reachableQuery.data && (
            <span className="text-xs text-stone-400 ml-2">
              Remaining movement: <span className="text-amber-400 font-medium">{reachableQuery.data.remainingFt} ft</span>
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {isDm && (
            <button
              type="button"
              onClick={() => setPaintMode((p) => !p)}
              title="Click a cell to cycle normal / difficult terrain / impassable"
              className={`rounded-md border px-2 py-1 text-xs ${
                paintMode ? 'border-amber-600 bg-amber-950/30 text-amber-400' : 'border-stone-700 bg-stone-900 text-stone-400 hover:bg-stone-800'
              }`}
            >
              {paintMode ? 'Painting terrain (click cells)' : 'Paint terrain'}
            </button>
          )}
          {isDm && (
            <button
              type="button"
              onClick={() => setShowSetup((s) => !s)}
              className="text-xs text-stone-400 hover:text-stone-200 underline"
            >
              {showSetup ? 'Hide map settings' : 'Reconfigure map'}
            </button>
          )}
        </div>
      </div>
      {isDm && showSetup && (
        <MapSetupPanel campaignId={campaignId} encounterId={encounterId} map={map} onDone={() => setShowSetup(false)} />
      )}

      <div className="flex flex-col lg:flex-row gap-4">
        <div ref={scrollRef} className="flex-1 min-w-0 overflow-auto rounded-lg border border-stone-800 bg-stone-950 p-3">
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
                      the server-computed reachable set. Only the paint-mode
                      layer is actually clickable; reachable/terrain shading
                      alone stays pointer-events-none so it never blocks
                      token dragging underneath. */}
                  <div
                    className={`absolute inset-0 grid ${paintMode ? '' : 'pointer-events-none'}`}
                    style={{
                      gridTemplateColumns: `repeat(${map.gridColumns}, 1fr)`,
                      gridTemplateRows: `repeat(${map.gridRows}, 1fr)`,
                    }}
                  >
                    {Array.from({ length: map.gridRows }, (_, y) =>
                      Array.from({ length: map.gridColumns }, (_, x) => {
                        const override = overridesByCell.get(`${x},${y}`);
                        const isReachable = reachableCells.has(`${x},${y}`);
                        return (
                          <div
                            key={`${x},${y}`}
                            onClick={paintMode ? () => handleCellPaint(x, y) : undefined}
                            title={paintMode ? `${cellLabel(x, y)}: click to cycle terrain` : override?.note ?? undefined}
                            className={`${paintMode ? 'cursor-pointer hover:outline hover:outline-1 hover:outline-amber-500' : ''} ${
                              override ? OVERRIDE_TINT[override.cost_type] : ''
                            } ${isReachable && !override ? 'bg-emerald-600/15' : ''}`}
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
                      isActive={p.participantId === activeParticipantId}
                      isDraggable={isDm}
                      isSelected={p.participantId === selectedId}
                      onMove={(x, y) => positionMutation.mutate({ participantId: p.participantId, x, y })}
                      onSelect={() => setSelectedId((cur) => (cur === p.participantId ? null : p.participantId))}
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        {showRoster && (
          <RosterPanel
            participants={placed}
            activeParticipantId={activeParticipantId}
            selectedId={selectedId}
            onSelect={setSelectedId}
            isDm={isDm}
            onChangeFaction={
              isDm ? (participantId, faction) => factionMutation.mutate({ participantId, faction }) : undefined
            }
          />
        )}
      </div>

      {isDm && unplaced.length > 0 && (
        <div className="rounded-lg border border-stone-800 bg-stone-900 p-3">
          <p className="text-xs text-stone-500 mb-2">
            Unplaced — click a name to drop it at the top-left corner, then drag it into position:
          </p>
          <div className="flex flex-wrap gap-2">
            {unplaced.map((p) => (
              <button
                key={p.participantId}
                type="button"
                disabled={positionMutation.isPending}
                onClick={() => positionMutation.mutate({ participantId: p.participantId, x: 0, y: 0 })}
                className="rounded-md border border-stone-700 bg-stone-800 hover:bg-stone-700 px-2 py-1 text-xs text-stone-200 disabled:opacity-60"
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

// REFACTOR-PLAN.md §3: "side panel listing every participant with their
// current coordinate, two-way synced with the board: hovering or selecting
// in the list highlights the token and vice versa." Only lists PLACED
// participants — an unplaced one has no coordinate to show, and already has
// its own affordance below.
function RosterPanel({
  participants,
  activeParticipantId,
  selectedId,
  onSelect,
  isDm,
  onChangeFaction,
}: {
  participants: SnapshotParticipant[];
  activeParticipantId: number | null;
  selectedId: number | null;
  onSelect: (id: number | null) => void;
  isDm: boolean;
  onChangeFaction?: (participantId: number, faction: SnapshotParticipant['faction']) => void;
}) {
  return (
    <aside className="lg:w-64 flex-shrink-0 rounded-lg border border-stone-800 bg-stone-900 p-3">
      <h3 className="text-xs uppercase text-stone-500 mb-2">On the board</h3>
      {participants.length === 0 && <EmptyState message="No one is placed on the map yet." />}
      <ul className="space-y-1">
        {participants.map((p) => {
          const isActive = p.participantId === activeParticipantId;
          const isSelected = p.participantId === selectedId;
          return (
            <li
              key={p.participantId}
              onMouseEnter={() => onSelect(p.participantId)}
              onMouseLeave={() => onSelect(null)}
              onClick={() => onSelect(isSelected ? null : p.participantId)}
              className={`rounded-md px-2 py-1.5 text-sm cursor-pointer transition-colors ${
                isSelected ? 'bg-amber-950/40 border border-amber-700' : 'border border-transparent hover:bg-stone-800'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className={`truncate ${isActive ? 'text-amber-400 font-semibold' : 'text-stone-200'}`}>
                  {isActive && '▶ '}
                  {p.name}
                </span>
                <span className="text-[10px] text-stone-500 flex-shrink-0">
                  {p.posX != null && p.posY != null ? cellLabel(p.posX, p.posY) : '—'}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2 mt-0.5">
                <span className="text-[10px] text-stone-500">
                  {isExactHp(p.hp) ? `${p.hp.hpCurrent}/${p.hp.hpMax} HP` : p.hp.band}
                </span>
                {isDm && onChangeFaction ? (
                  <select
                    value={p.faction}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => onChangeFaction(p.participantId, e.target.value as SnapshotParticipant['faction'])}
                    className="text-[10px] rounded border border-stone-700 bg-stone-800 text-stone-300 px-1 py-0.5"
                  >
                    {FACTION_OPTIONS.map((f) => (
                      <option key={f.value} value={f.value}>
                        {f.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="text-[10px] text-stone-500 capitalize">{p.faction}</span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </aside>
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
  campaignId: number;
  encounterId: number;
  map: MapConfig | null;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const [gridColumns, setGridColumns] = useState(map?.gridColumns ?? 20);
  const [gridRows, setGridRows] = useState(map?.gridRows ?? 20);
  const [cellSizePx, setCellSizePx] = useState(map?.cellSizePx ?? 50);
  const [feetPerCell, setFeetPerCell] = useState(map?.feetPerCell ?? 5);
  const [backgroundAssetId, setBackgroundAssetId] = useState<number | null>(map?.backgroundAssetId ?? null);

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
    <div className="rounded-lg border border-stone-800 bg-stone-900 p-4 space-y-4">
      <h3 className="text-xs uppercase text-stone-500">Map settings</h3>

      {saveMutation.isError && <ErrorBanner message={errorMessage(saveMutation.error)} />}

      <div className="flex flex-wrap gap-4">
        <label className="flex flex-col gap-1 text-xs text-stone-400">
          Columns
          <input
            type="number"
            min={GRID_MIN}
            max={GRID_MAX}
            value={gridColumns}
            onChange={(e) => setGridColumns(clamp(Number(e.target.value), GRID_MIN, GRID_MAX))}
            className="rounded-md bg-stone-800 border border-stone-700 px-2 py-1 text-sm text-stone-100 w-20"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-stone-400">
          Rows
          <input
            type="number"
            min={GRID_MIN}
            max={GRID_MAX}
            value={gridRows}
            onChange={(e) => setGridRows(clamp(Number(e.target.value), GRID_MIN, GRID_MAX))}
            className="rounded-md bg-stone-800 border border-stone-700 px-2 py-1 text-sm text-stone-100 w-20"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-stone-400">
          Cell size (display px)
          <input
            type="number"
            min={CELL_SIZE_MIN}
            max={CELL_SIZE_MAX}
            value={cellSizePx}
            onChange={(e) => setCellSizePx(clamp(Number(e.target.value), CELL_SIZE_MIN, CELL_SIZE_MAX))}
            className="rounded-md bg-stone-800 border border-stone-700 px-2 py-1 text-sm text-stone-100 w-24"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-stone-400">
          Feet per cell (movement math — separate from display size)
          <input
            type="number"
            min={1}
            max={50}
            value={feetPerCell}
            onChange={(e) => setFeetPerCell(clamp(Number(e.target.value), 1, 50))}
            className="rounded-md bg-stone-800 border border-stone-700 px-2 py-1 text-sm text-stone-100 w-24"
          />
        </label>
      </div>

      <div>
        <p className="text-xs text-stone-500 mb-2">Background image</p>
        <div className="flex items-center gap-3">
          <Portrait fileUrl={selectedAsset?.file_url} alt="Map background" size="lg" placeholderLabel="Map" />
          <div className="flex flex-col gap-2">
            <ImageUploadField campaignId={campaignId} onUploaded={handleAssetUploaded} label="Upload new image" />
            {backgroundAssetId !== null && (
              <button
                type="button"
                onClick={() => setBackgroundAssetId(null)}
                className="text-xs text-stone-400 hover:text-stone-200 text-left"
              >
                Clear background
              </button>
            )}
          </div>
        </div>
        {assetsQuery.data && assetsQuery.data.assets.length > 0 && (
          <div className="mt-3">
            <p className="text-[10px] text-stone-500 mb-1.5">Or pick an existing campaign asset:</p>
            <div className="flex flex-wrap gap-2">
              {assetsQuery.data.assets
                .filter((a) => a.asset_type === 'image')
                .map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => setBackgroundAssetId(a.id)}
                    className={`rounded-md ${backgroundAssetId === a.id ? 'ring-2 ring-amber-500' : ''}`}
                    aria-label={`Select ${a.title ?? 'asset'} as map background`}
                  >
                    <Portrait fileUrl={a.file_url} alt={a.title ?? 'Campaign asset'} size="sm" />
                  </button>
                ))}
            </div>
          </div>
        )}
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending}
          className="rounded-md border border-amber-500 text-amber-500 hover:bg-amber-500/10 active:bg-amber-500/20 disabled:opacity-45 disabled:cursor-not-allowed font-semibold px-3 py-1.5 text-sm"
        >
          {saveMutation.isPending ? 'Saving…' : 'Save map settings'}
        </button>
        {map && (
          <button type="button" onClick={onDone} className="text-sm text-stone-400 hover:text-stone-200 px-3 py-1.5">
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}

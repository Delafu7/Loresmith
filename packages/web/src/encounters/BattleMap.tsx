// Battle map (Phase 3.3) — a CSS-grid + absolutely-positioned-divs surface,
// no canvas/SVG/drag library (none exists in this app; the design brief is
// explicit on this point). Dragging is native pointer events, entirely local
// to Token.tsx during the drag — only the FINAL dropped cell is persisted via
// PATCH .../position and broadcast as TOKEN_MOVED. Firing that mutation on
// every pointermove tick would be a write/broadcast storm; this component
// (and Token.tsx) are built specifically to avoid that.

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { CampaignAsset, SnapshotParticipant } from '../lib/types';
import type { MapConfig } from '../lib/socketTypes';
import { Portrait } from '../components/Portrait';
import { ImageUploadField } from '../components/ImageUploadField';
import { ErrorBanner, EmptyState, errorMessage } from '../components/Feedback';
import { Token } from './Token';

const CELL_SIZE_PRESETS = [
  { label: 'Small', value: 32 },
  { label: 'Medium', value: 50 },
  { label: 'Large', value: 70 },
];

const GRID_MIN = 5;
const GRID_MAX = 50;

function clamp(n: number, min: number, max: number): number {
  if (Number.isNaN(n)) return min;
  return Math.min(Math.max(Math.round(n), min), max);
}

export function BattleMap({
  encounterId,
  campaignId,
  map,
  participants,
  activeParticipantId,
  isDm,
}: {
  encounterId: number;
  campaignId: number;
  map: MapConfig | null;
  participants: SnapshotParticipant[];
  activeParticipantId: number | null;
  isDm: boolean;
}) {
  const [showSetup, setShowSetup] = useState(false);

  const positionMutation = useMutation({
    mutationFn: ({ participantId, x, y }: { participantId: number; x: number | null; y: number | null }) =>
      api.patch(`/encounters/${encounterId}/participants/${participantId}/position`, { x, y }),
    // No cache write on success, on purpose: TOKEN_MOVED arriving over the
    // socket (which the DM's own action also triggers) is the single source
    // of truth for token position, same discipline as CombatTracker's
    // hpMutation/applyEffectMutation.
  });

  const placed = participants.filter((p) => p.posX != null && p.posY != null);
  const unplaced = participants.filter((p) => p.posX == null || p.posY == null);

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

  return (
    <div className="space-y-4">
      {positionMutation.isError && <ErrorBanner message={errorMessage(positionMutation.error)} />}

      {isDm && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => setShowSetup((s) => !s)}
            className="text-xs text-stone-400 hover:text-stone-200 underline"
          >
            {showSetup ? 'Hide map settings' : 'Reconfigure map'}
          </button>
        </div>
      )}
      {isDm && showSetup && (
        <MapSetupPanel campaignId={campaignId} encounterId={encounterId} map={map} onDone={() => setShowSetup(false)} />
      )}

      <div className="overflow-auto rounded-lg border border-stone-800 bg-stone-950 p-3">
        <div className="relative" style={{ width: map.gridColumns * map.cellSizePx, height: map.gridRows * map.cellSizePx }}>
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

          {placed.map((p) => (
            <Token
              key={p.participantId}
              participant={p}
              cellSizePx={map.cellSizePx}
              gridColumns={map.gridColumns}
              gridRows={map.gridRows}
              isActive={p.participantId === activeParticipantId}
              isDraggable={isDm}
              onMove={(x, y) => positionMutation.mutate({ participantId: p.participantId, x, y })}
            />
          ))}
        </div>
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
    mutationFn: () => api.put(`/encounters/${encounterId}/map`, { backgroundAssetId, gridColumns, gridRows, cellSizePx }),
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
        <div className="flex flex-col gap-1 text-xs text-stone-400">
          Cell size
          <div className="flex gap-1">
            {CELL_SIZE_PRESETS.map((preset) => (
              <button
                key={preset.value}
                type="button"
                onClick={() => setCellSizePx(preset.value)}
                className={`rounded-md border px-2 py-1 text-xs ${
                  cellSizePx === preset.value
                    ? 'border-amber-600 bg-amber-950/30 text-amber-400'
                    : 'border-stone-700 bg-stone-800 text-stone-300'
                }`}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>
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
          className="rounded-md bg-amber-600 hover:bg-amber-500 disabled:opacity-60 text-stone-950 font-semibold px-3 py-1.5 text-sm"
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

// SVG-masked fog-of-war overlay — an opaque dark rect punched through by
// each viewer's visibility polygon via an SVG <mask> (composited above the
// existing div-based grid/token layers, never canvas/clip-path — see the
// approved plan's fog-rendering decision). Polygon UNION across overlapping
// viewers is free: overlapping white/gray shapes in the mask just overlap,
// no polygon-boolean library needed.
//
// Renders identically for a real player and for the DM's "preview player
// view" toggle — both show the union of every `faction === 'player'`
// token's vision (shared party vision, not per-character). The DM's own
// default (non-preview) view never mounts this component at all, so
// `active` gates the whole thing rather than being threaded through as a
// zero-opacity no-op.
//
// Persisted "explored" memory (dimly-remembered previously-seen areas) is
// deliberately NOT implemented here — out of scope for this pass per the
// plan's cross-cutting decision (noted as a cheap follow-up if it turns out
// to matter); only CURRENTLY visible area is shown, everything else is dark.
import { useId, useMemo, useRef } from 'react';
import type { MapElementOrRedacted, SnapshotParticipant } from '../../lib/types';
import { cellToPx, feetToCells } from '../geometry';
import { wallSegmentsFromElements } from './segments';
import { buildFogPolygons, type FogPolygon } from './fogUnion';
import type { Segment } from './raycast';

interface CacheEntry {
  participant: SnapshotParticipant;
  wallSegments: Segment[];
  polygons: FogPolygon[];
}

export function VisionOverlay({
  participants,
  mapElements,
  cellSizePx,
  feetPerCell,
  mapWidthPx,
  mapHeightPx,
  active,
}: {
  participants: SnapshotParticipant[];
  mapElements: MapElementOrRedacted[];
  cellSizePx: number;
  feetPerCell: number;
  mapWidthPx: number;
  mapHeightPx: number;
  active: boolean;
}) {
  // Recomputed only when the wall/door layout itself changes (element
  // create/update/delete) — not on every token move.
  const wallSegments = useMemo(() => wallSegmentsFromElements(mapElements, cellSizePx), [mapElements, cellSizePx]);

  const viewers = useMemo(
    () => participants.filter((p) => p.faction === 'player' && p.visionEnabled && p.posX != null && p.posY != null),
    [participants],
  );

  // Per-viewer memoization keyed on object-reference identity, not the
  // (always-fresh-array) `viewers`/`participants` reference itself:
  // useEncounterLive's patch functions preserve a participant's object
  // reference for every socket event that didn't touch it (see Token.tsx's
  // own comment on the same guarantee), so dragging ONE token only ever
  // invalidates that token's cache entry — every other viewer's polygon is
  // reused as-is, and the expensive raycast never reruns for it.
  const cacheRef = useRef(new Map<string, CacheEntry>());

  const polygons = useMemo(() => {
    const previous = cacheRef.current;
    const next = new Map<string, CacheEntry>();
    const all: FogPolygon[] = [];
    for (const p of viewers) {
      const cached = previous.get(p.participantId);
      const entry: CacheEntry =
        cached && cached.participant === p && cached.wallSegments === wallSegments
          ? cached
          : {
              participant: p,
              wallSegments,
              polygons: buildFogPolygons(
                [
                  {
                    id: p.participantId,
                    origin: { x: cellToPx(p.posX! + 0.5, cellSizePx), y: cellToPx(p.posY! + 0.5, cellSizePx) },
                    visionRadiusPx: feetToCells(p.visionRadiusFt, feetPerCell) * cellSizePx,
                    darkvisionRadiusPx: feetToCells(p.darkvisionRadiusFt, feetPerCell) * cellSizePx,
                    enabled: true,
                  },
                ],
                wallSegments,
              ),
            };
      next.set(p.participantId, entry);
      all.push(...entry.polygons);
    }
    cacheRef.current = next;
    return all;
  }, [viewers, wallSegments, cellSizePx, feetPerCell]);

  const rawId = useId();
  const maskId = `battle-map-vision-mask-${rawId.replace(/[^a-zA-Z0-9]/g, '')}`;

  if (!active) return null;

  const brightPolygons = polygons.filter((p) => p.band === 'bright');
  const darkvisionPolygons = polygons.filter((p) => p.band === 'darkvision');

  return (
    <svg className="absolute inset-0 pointer-events-none" width={mapWidthPx} height={mapHeightPx}>
      <defs>
        <mask id={maskId} maskUnits="userSpaceOnUse" x={0} y={0} width={mapWidthPx} height={mapHeightPx}>
          <rect x={0} y={0} width={mapWidthPx} height={mapHeightPx} fill="white" />
          {/* Darkvision punches a partial (dim/grayscale-ish) hole; bright is drawn last so it always wins where the two overlap. */}
          {darkvisionPolygons.map((p) => (
            <polygon key={p.id} points={p.points.map((pt) => `${pt.x},${pt.y}`).join(' ')} fill="#555555" />
          ))}
          {brightPolygons.map((p) => (
            <polygon key={p.id} points={p.points.map((pt) => `${pt.x},${pt.y}`).join(' ')} fill="black" />
          ))}
        </mask>
      </defs>
      <rect x={0} y={0} width={mapWidthPx} height={mapHeightPx} fill="#0c0a09" fillOpacity={0.92} mask={`url(#${maskId})`} />
    </svg>
  );
}

// The generic MapElement registry (see lib/types.ts's MapElement doc comment
// for the "adding a type is a pure registry entry" contract). Every consumer
// (ElementPalette, MapCanvasElements, ElementPropertyPanel) is generic over
// this file and must never grow a per-type branch — proven by `image`, which
// has zero legacy system underneath it and needed nothing beyond one entry
// here plus its Zod/discriminated-union branch server- and lib/types.ts-side.
//
// `render`/`defaults` are typed per-arm (so each entry's own implementation
// is fully type-checked against its own props shape), but the REGISTRY
// itself is necessarily read through a couple of controlled casts where a
// caller only has the general `MapElementType`/`MapElement` — TypeScript's
// mapped-type indexing can't correlate "this specific union member" back to
// "this specific entry" automatically (the classic correlated-union
// limitation). Those casts are function-type casts, not `any`, and are
// isolated to the three helpers at the bottom of this file — no consumer
// component ever casts anything itself.

import type { MouseEvent, ReactNode } from 'react';
import type { MapElement, MapElementOrRedacted, MapElementType } from '../../lib/types';
import { WallIcon, DoorIcon, LightIcon, AreaIcon, NoteIcon, ImageIcon } from './icons';
import { segmentStyle } from './geometry';

export type ElementPlacement = 'point' | 'segment' | 'polygon';

export type ElementFieldSpec =
  | { key: string; kind: 'text'; labelKey: string; maxLength?: number }
  | { key: string; kind: 'textarea'; labelKey: string; maxLength?: number }
  | { key: string; kind: 'number'; labelKey: string; min?: number; max?: number; step?: number }
  | { key: string; kind: 'select'; labelKey: string; options: { value: string; labelKey: string }[] }
  | { key: string; kind: 'color'; labelKey: string }
  // 0..1 slider (intensity/opacity) — distinct from 'number' so the property
  // panel can render a <input type="range" min={0} max={1} step={0.05}>
  // instead of a plain numeric box.
  | { key: string; kind: 'unit'; labelKey: string };

export interface ElementRenderCtx {
  cellSizePx: number;
  isSelected: boolean;
  /** GM-only visibility layer — the click event is passed through so the
   * caller can detect a shift-click for multi-select (mirrors the token
   * multi-select shift-click pattern in BattleMap.tsx), not just "select this". */
  onSelect: (e: MouseEvent) => void;
  /** Resolves an image element's assetId to a servable file URL — undefined while the asset list is still loading or the asset was deleted. */
  resolveAssetUrl: (assetId: string) => string | undefined;
}

export interface ElementDefaults<T extends MapElementType> {
  props: Extract<MapElement, { type: T }>['props'];
  label?: string | null;
  visibility?: 'gm_only' | 'revealed_to_players' | 'owner_only';
}

/** Palette grouping only — purely presentational, no behavioral branch reads
 * this (ElementPalette.tsx groups by it; nothing else does). */
export type ElementCategory = 'structure' | 'lighting' | 'area' | 'annotation';

export interface ElementRegistryEntry<T extends MapElementType> {
  type: T;
  labelKey: string;
  icon: (props: { size?: number; className?: string }) => ReactNode;
  category: ElementCategory;
  /** 'point' = one click places x1/y1. 'segment' = two clicks place x1/y1 then x2/y2. 'polygon' = clicks accumulate into `points` until the placer finishes (min 3). */
  placement: ElementPlacement;
  blocksVision: (el: Extract<MapElement, { type: T }>) => boolean;
  blocksMovement: (el: Extract<MapElement, { type: T }>) => boolean;
  defaults: () => ElementDefaults<T>;
  /** Property-panel fields, each targeting `props.<key>` — every type shares label/visibility/locked generically (ElementPropertyPanel.tsx), so this list only ever needs type-specific `props` fields. */
  fields: ElementFieldSpec[];
  render: (el: Extract<MapElement, { type: T }>, ctx: ElementRenderCtx) => ReactNode;
}

const STROKE_WIDTH_PX = 5;

export const ELEMENT_REGISTRY: { [K in MapElementType]: ElementRegistryEntry<K> } = {
  wall: {
    type: 'wall',
    labelKey: 'encounters.mapElements.types.wall',
    icon: WallIcon,
    category: 'structure',
    placement: 'segment',
    blocksVision: () => true,
    blocksMovement: () => true,
    // GM-only visibility layer — a wall is a structural GM aid, not
    // something a player is meant to see drawn on the map (only its
    // vision-blocking EFFECT matters to them). Defaults to 'gm_only' so a
    // freshly-placed wall is invisible to players immediately; formatMapElementForViewer
    // still forwards a geometry-only redacted stub (blocksVision: true) for
    // the darkness vision filter/fog-of-war raycaster either way, and a DM
    // can still flip it to 'revealed_to_players' via the existing
    // reveal/hide toggle if they ever want one drawn for players too.
    defaults: () => ({ props: {}, visibility: 'gm_only' }),
    fields: [],
    render: (el, ctx) => {
      if (el.x2 == null || el.y2 == null) return null;
      const style = segmentStyle(el.x1 * ctx.cellSizePx, el.y1 * ctx.cellSizePx, el.x2 * ctx.cellSizePx, el.y2 * ctx.cellSizePx, STROKE_WIDTH_PX);
      return (
        <div
          onClick={(e) => {
            e.stopPropagation();
            ctx.onSelect(e);
          }}
          style={style}
          // Distinct saturated accent (cyan) — GM-only, so this only ever
          // renders for the DM (see MapCanvasElements.tsx: a redacted stub
          // is never rendered), unused by any other element type's color.
          className={`cursor-pointer rounded-full bg-cyan-400 ${ctx.isSelected ? 'ring-2 ring-amber-400' : ''}`}
        />
      );
    },
  },

  door: {
    type: 'door',
    labelKey: 'encounters.mapElements.types.door',
    icon: DoorIcon,
    category: 'structure',
    placement: 'segment',
    blocksVision: (el) => el.props.state !== 'open',
    blocksMovement: (el) => el.props.state === 'locked',
    defaults: () => ({ props: { state: 'closed' } }),
    fields: [
      {
        key: 'state',
        kind: 'select',
        labelKey: 'encounters.mapElements.fields.doorState',
        options: [
          { value: 'open', labelKey: 'encounters.mapElements.doorStates.open' },
          { value: 'closed', labelKey: 'encounters.mapElements.doorStates.closed' },
          { value: 'locked', labelKey: 'encounters.mapElements.doorStates.locked' },
        ],
      },
    ],
    render: (el, ctx) => {
      if (el.x2 == null || el.y2 == null) return null;
      const style = segmentStyle(el.x1 * ctx.cellSizePx, el.y1 * ctx.cellSizePx, el.x2 * ctx.cellSizePx, el.y2 * ctx.cellSizePx, STROKE_WIDTH_PX + 3);
      const color = el.props.state === 'open' ? 'bg-emerald-600/70' : el.props.state === 'locked' ? 'bg-red-700' : 'bg-amber-700';
      return (
        <div
          onClick={(e) => {
            e.stopPropagation();
            ctx.onSelect(e);
          }}
          style={style}
          className={`cursor-pointer rounded-full ${color} ${ctx.isSelected ? 'ring-2 ring-amber-400' : ''}`}
        />
      );
    },
  },

  light: {
    type: 'light',
    labelKey: 'encounters.mapElements.types.light',
    icon: LightIcon,
    category: 'lighting',
    placement: 'point',
    blocksVision: () => false,
    blocksMovement: () => false,
    defaults: () => ({ props: { brightRadiusFt: 20, dimRadiusFt: 40, color: '#fbbf24', intensity: 0.6 } }),
    fields: [
      { key: 'brightRadiusFt', kind: 'number', labelKey: 'encounters.mapElements.fields.brightRadiusFt', min: 0, max: 500, step: 5 },
      { key: 'dimRadiusFt', kind: 'number', labelKey: 'encounters.mapElements.fields.dimRadiusFt', min: 0, max: 500, step: 5 },
      { key: 'color', kind: 'color', labelKey: 'encounters.mapElements.fields.color' },
      { key: 'intensity', kind: 'unit', labelKey: 'encounters.mapElements.fields.intensity' },
    ],
    render: (el, ctx) => {
      const px = el.x1 * ctx.cellSizePx;
      const py = el.y1 * ctx.cellSizePx;
      const radiusPx = (el.props.dimRadiusFt / 5) * ctx.cellSizePx; // feetPerCell fallback of 5 is refined once geometry.ts's feet<->cell helpers land in Phase 2
      return (
        <div
          onClick={(e) => {
            e.stopPropagation();
            ctx.onSelect(e);
          }}
          style={{
            position: 'absolute',
            left: px - radiusPx,
            top: py - radiusPx,
            width: radiusPx * 2,
            height: radiusPx * 2,
            background: `radial-gradient(circle, ${el.props.color}${Math.round(el.props.intensity * 60 + 10)} 0%, transparent 70%)`,
          }}
          className={`cursor-pointer rounded-full ${ctx.isSelected ? 'ring-2 ring-amber-400' : ''}`}
        >
          <LightIcon size={16} className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-amber-300" />
        </div>
      );
    },
  },

  area: {
    type: 'area',
    labelKey: 'encounters.mapElements.types.area',
    icon: AreaIcon,
    category: 'area',
    placement: 'polygon',
    blocksVision: () => false,
    blocksMovement: () => false,
    defaults: () => ({ props: { shape: 'polygon', costType: 'difficult', color: '#a855f7' } }),
    fields: [
      {
        key: 'costType',
        kind: 'select',
        labelKey: 'encounters.mapElements.fields.costType',
        options: [
          { value: 'difficult', labelKey: 'encounters.mapElements.costTypes.difficult' },
          { value: 'note-only', labelKey: 'encounters.mapElements.costTypes.noteOnly' },
        ],
      },
      { key: 'color', kind: 'color', labelKey: 'encounters.mapElements.fields.color' },
    ],
    render: (el, ctx) => {
      const pointsAttr = el.points.map((p) => `${p.x * ctx.cellSizePx},${p.y * ctx.cellSizePx}`).join(' ');
      return (
        <svg
          onClick={(e) => {
            e.stopPropagation();
            ctx.onSelect(e);
          }}
          className="absolute inset-0 h-full w-full cursor-pointer"
          style={{ pointerEvents: 'none' }}
        >
          <polygon points={pointsAttr} fill={el.props.color} fillOpacity={0.25} stroke={el.props.color} strokeWidth={2} style={{ pointerEvents: 'auto' }} />
          {ctx.isSelected && <polygon points={pointsAttr} fill="none" stroke="#fbbf24" strokeWidth={2} strokeDasharray="4 3" />}
        </svg>
      );
    },
  },

  note: {
    type: 'note',
    labelKey: 'encounters.mapElements.types.note',
    icon: NoteIcon,
    category: 'annotation',
    placement: 'point',
    blocksVision: () => false,
    blocksMovement: () => false,
    defaults: () => ({ props: { body: '' }, visibility: 'gm_only' }),
    fields: [{ key: 'body', kind: 'textarea', labelKey: 'encounters.mapElements.fields.noteBody', maxLength: 5000 }],
    render: (el, ctx) => (
      <div
        onClick={(e) => {
          e.stopPropagation();
          ctx.onSelect(e);
        }}
        style={{ position: 'absolute', left: el.x1 * ctx.cellSizePx - 10, top: el.y1 * ctx.cellSizePx - 10 }}
        className={`flex h-5 w-5 cursor-pointer items-center justify-center rounded-full bg-sky-900 text-sky-200 ${ctx.isSelected ? 'ring-2 ring-amber-400' : ''}`}
        title={el.label ?? undefined}
      >
        <NoteIcon size={13} />
      </div>
    ),
  },

  image: {
    type: 'image',
    labelKey: 'encounters.mapElements.types.image',
    icon: ImageIcon,
    category: 'annotation',
    placement: 'point',
    blocksVision: () => false,
    blocksMovement: () => false,
    defaults: () => ({ props: { assetId: null, widthFt: 25, heightFt: 25, rotationDeg: 0, opacity: 1 } }),
    fields: [
      { key: 'widthFt', kind: 'number', labelKey: 'encounters.mapElements.fields.widthFt', min: 1, max: 500, step: 5 },
      { key: 'heightFt', kind: 'number', labelKey: 'encounters.mapElements.fields.heightFt', min: 1, max: 500, step: 5 },
      { key: 'rotationDeg', kind: 'number', labelKey: 'encounters.mapElements.fields.rotationDeg', min: 0, max: 359, step: 5 },
      { key: 'opacity', kind: 'unit', labelKey: 'encounters.mapElements.fields.opacity' },
    ],
    render: (el, ctx) => {
      const widthPx = (el.props.widthFt / 5) * ctx.cellSizePx;
      const heightPx = (el.props.heightFt / 5) * ctx.cellSizePx;
      const url = el.props.assetId ? ctx.resolveAssetUrl(el.props.assetId) : undefined;
      return (
        <div
          onClick={(e) => {
            e.stopPropagation();
            ctx.onSelect(e);
          }}
          style={{
            position: 'absolute',
            left: el.x1 * ctx.cellSizePx - widthPx / 2,
            top: el.y1 * ctx.cellSizePx - heightPx / 2,
            width: widthPx,
            height: heightPx,
            transform: `rotate(${el.props.rotationDeg}deg)`,
            opacity: el.props.opacity,
          }}
          className={`cursor-pointer ${ctx.isSelected ? 'ring-2 ring-amber-400' : ''}`}
        >
          {url ? (
            <img src={url} alt={el.label ?? 'Map image'} draggable={false} className="h-full w-full select-none object-contain" />
          ) : (
            <div className="flex h-full w-full items-center justify-center rounded-md bg-stone-800/70 text-stone-500">
              <ImageIcon size={20} />
            </div>
          )}
        </div>
      );
    },
  },
};

/** Ordered for palette rendering — Object.values would work too but this pins a stable, deliberate order. */
export const ELEMENT_TYPES: MapElementType[] = ['wall', 'door', 'light', 'area', 'note', 'image'];

/** Category display order + label, for ElementPalette.tsx's grouping. */
export const ELEMENT_CATEGORIES: { key: ElementCategory; labelKey: string }[] = [
  { key: 'structure', labelKey: 'encounters.mapElements.categories.structure' },
  { key: 'lighting', labelKey: 'encounters.mapElements.categories.lighting' },
  { key: 'area', labelKey: 'encounters.mapElements.categories.area' },
  { key: 'annotation', labelKey: 'encounters.mapElements.categories.annotation' },
];

export function renderMapElement(el: MapElement, ctx: ElementRenderCtx): ReactNode {
  const entry = ELEMENT_REGISTRY[el.type];
  return (entry.render as (el: MapElement, ctx: ElementRenderCtx) => ReactNode)(el, ctx);
}

// Synthetic, unsaved MapElement for the live placement-preview ghost
// (BattleMap.tsx) — always built from the type's own `defaults()`, so the
// preview always matches exactly what create-on-commit would actually
// produce, with zero per-type logic at the call site. Same controlled-cast
// pattern as the helpers above: TypeScript can't correlate a general
// MapElementType back to its specific props/points shape from outside the
// registry, so the one unavoidable cast lives here instead of in
// BattleMap.tsx.
export function buildPreviewElement(
  type: MapElementType,
  x1: number,
  y1: number,
  x2: number | null,
  y2: number | null,
  points: { x: number; y: number }[] | null,
): MapElement {
  const entry = ELEMENT_REGISTRY[type];
  const d = entry.defaults();
  return {
    id: '__placement-preview__',
    mapId: '',
    x1,
    y1,
    x2,
    y2,
    points,
    label: d.label ?? null,
    visibility: d.visibility ?? 'revealed_to_players',
    ownerUserId: null,
    locked: false,
    zIndex: 0,
    type,
    props: d.props,
  } as MapElement;
}

// GM-only visibility layer — a hidden wall/door arrives from the server as
// a RedactedMapElement stub (geometry-only, see lib/types.ts), not a full
// MapElement, so this must short-circuit before indexing the type registry
// (needed by vision/segments.ts's raycasting, which sees both shapes).
export function elementBlocksVision(el: MapElementOrRedacted): boolean {
  if ('redacted' in el && el.redacted) return el.blocksVision ?? false;
  // Same "one controlled cast" pattern as the other helpers in this file —
  // `el` is a full MapElement here (the branch above already excluded
  // RedactedMapElement), TS just can't prove it through the compound `in`
  // check above.
  const full = el as MapElement;
  const entry = ELEMENT_REGISTRY[full.type];
  return (entry.blocksVision as (el: MapElement) => boolean)(full);
}

export function elementBlocksMovement(el: MapElement): boolean {
  const entry = ELEMENT_REGISTRY[el.type];
  return (entry.blocksMovement as (el: MapElement) => boolean)(el);
}

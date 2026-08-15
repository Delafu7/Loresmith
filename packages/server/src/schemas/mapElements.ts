import { z } from 'zod';

// Generic DM map elements (walls/doors/lights/areas/notes/images) — see
// 1784269816666_create-map-elements.ts's header comment for the schema
// rationale. One Zod branch per type validates that type's `props` shape;
// the DB column itself stays an unvalidated JSONB catch-all so a future
// type only needs a new branch here (and a registry entry client-side),
// never a migration.

const baseFields = {
  label: z.string().max(200).nullable().optional(),
  // GM-only visibility layer — 'gm_only' | 'revealed_to_players' |
  // 'owner_only', replacing the old visibleToPlayers boolean. ownerUserId is
  // only meaningful (and only persisted) when visibility is 'owner_only'
  // (see services/mapElements.ts's createMapElement/updateMapElement).
  visibility: z.enum(['gm_only', 'revealed_to_players', 'owner_only']).optional(),
  ownerUserId: z.string().uuid().nullable().optional(),
  locked: z.boolean().optional(),
  zIndex: z.number().int().optional(),
};

const wallElementSchema = z.object({
  type: z.literal('wall'),
  x1: z.number(),
  y1: z.number(),
  x2: z.number(),
  y2: z.number(),
  ...baseFields,
});

const doorElementSchema = z.object({
  type: z.literal('door'),
  x1: z.number(),
  y1: z.number(),
  x2: z.number(),
  y2: z.number(),
  props: z.object({ state: z.enum(['open', 'closed', 'locked', 'stuck', 'broken']), forceDC: z.number().int().min(1).max(30).optional() }),
  ...baseFields,
});

const lightElementSchema = z.object({
  type: z.literal('light'),
  x1: z.number(),
  y1: z.number(),
  props: z.object({
    brightRadiusFt: z.number().nonnegative(),
    dimRadiusFt: z.number().nonnegative(),
    color: z.string().max(20),
    intensity: z.number().min(0).max(1),
  }),
  ...baseFields,
});

const areaElementSchema = z.object({
  type: z.literal('area'),
  points: z.array(z.object({ x: z.number(), y: z.number() })).min(3),
  props: z.object({
    shape: z.enum(['rect', 'circle', 'polygon']),
    costType: z.enum(['difficult', 'note-only']),
    color: z.string().max(20),
  }),
  ...baseFields,
});

// `note` elements now honor `visibility` uniformly like every other type —
// server-side filtering (services/mapElements.ts's formatMapElementForViewer)
// is what enforces it (GET /:id/map/elements, FULL_STATE_SYNC, and
// MAP_ELEMENTS_CHANGED all route through it). Notes are backfilled to
// 'gm_only' on migrate regardless of their old visible_to_players value,
// since that's what the client actually enforced in practice before this
// layer existed (see 1784269819666_add-map-elements-visibility.ts).
const noteElementSchema = z.object({
  type: z.literal('note'),
  x1: z.number(),
  y1: z.number(),
  props: z.object({ body: z.string().max(5000) }),
  ...baseFields,
});

const imageElementSchema = z.object({
  type: z.literal('image'),
  x1: z.number(),
  y1: z.number(),
  props: z.object({
    assetId: z.string().uuid().nullable(),
    widthFt: z.number().positive(),
    heightFt: z.number().positive(),
    rotationDeg: z.number(),
    opacity: z.number().min(0).max(1),
  }),
  ...baseFields,
});

export const createMapElementSchema = z.discriminatedUnion('type', [
  wallElementSchema,
  doorElementSchema,
  lightElementSchema,
  areaElementSchema,
  noteElementSchema,
  imageElementSchema,
]);
export type CreateMapElementInput = z.infer<typeof createMapElementSchema>;

// `type` is immutable after creation (changing an element's fundamental kind
// isn't an edit, it's delete-and-recreate), so an update never carries it and
// `props` is only loosely validated here (merged shallowly into the existing
// row's props by the service) rather than re-deriving which branch applies.
export const updateMapElementSchema = z.object({
  x1: z.number().optional(),
  y1: z.number().optional(),
  x2: z.number().nullable().optional(),
  y2: z.number().nullable().optional(),
  points: z.array(z.object({ x: z.number(), y: z.number() })).nullable().optional(),
  props: z.record(z.string(), z.unknown()).optional(),
  ...baseFields,
});
export type UpdateMapElementInput = z.infer<typeof updateMapElementSchema>;

// GM-only visibility layer — bulk reveal/hide for BattleMap.tsx's
// multi-select toolbar.
export const batchSetMapElementsVisibilitySchema = z.object({
  elementIds: z.array(z.string().uuid()).min(1),
  visibility: z.enum(['gm_only', 'revealed_to_players', 'owner_only']),
  ownerUserId: z.string().uuid().nullable().optional(),
});
export type BatchSetMapElementsVisibilityInput = z.infer<typeof batchSetMapElementsVisibilitySchema>;

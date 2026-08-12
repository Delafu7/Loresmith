import { z } from 'zod';

// Generic DM map elements (walls/doors/lights/areas/notes/images) — see
// 1784269816666_create-map-elements.ts's header comment for the schema
// rationale. One Zod branch per type validates that type's `props` shape;
// the DB column itself stays an unvalidated JSONB catch-all so a future
// type only needs a new branch here (and a registry entry client-side),
// never a migration.

const baseFields = {
  label: z.string().max(200).nullable().optional(),
  visibleToPlayers: z.boolean().optional(),
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
  props: z.object({ state: z.enum(['open', 'closed', 'locked']) }),
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

// `note` elements are DM-only by construction — visibleToPlayers is accepted
// for schema symmetry but the route layer never honors true for this type
// (see routes/encounters.ts's map-elements GET, which strips notes for
// non-DM viewers unconditionally).
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

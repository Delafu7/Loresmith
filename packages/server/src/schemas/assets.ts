import { z } from 'zod';

// Validates the multipart form's non-file fields for POST /campaigns/:id/assets.
// Multipart fields always arrive as strings (there is no JSON body alongside
// the file part), so numeric fields need z.coerce — same convention as
// schemas/catalog.ts's editionQuerySchema query-string coercion.
//
// asset_type is NOT a client-supplied field: this phase only ever writes
// asset_type='image' (see services/assets.ts) — 'handout' is reserved for a
// later phase, so there is nothing for a caller to choose yet.
export const createAssetFieldsSchema = z.object({
  characterId: z.string().uuid().optional(),
  title: z.string().min(1).max(200).optional(),
});
export type CreateAssetFieldsInput = z.infer<typeof createAssetFieldsSchema>;

// PATCH /assets/:id — plain JSON body (not multipart), so no z.coerce needed.
// title is required (not .optional()): this is a single-field rename
// endpoint, so there's no meaningful "partial" update to make.
export const updateAssetSchema = z.object({
  title: z.string().min(1).max(200),
});
export type UpdateAssetInput = z.infer<typeof updateAssetSchema>;

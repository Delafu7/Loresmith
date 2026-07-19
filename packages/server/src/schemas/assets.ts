import { z } from 'zod';

// Validates the multipart form's non-file fields for POST /campaigns/:id/assets.
// Multipart fields always arrive as strings (there is no JSON body alongside
// the file part), so numeric fields need z.coerce — same convention as
// schemas/catalog.ts's editionQuerySchema query-string coercion.
//
// visibleToPlayers is deliberately NOT z.coerce.boolean(): JS's Boolean(...)
// coerces any non-empty string (including the literal string "false") to
// true, which would silently flip a client's intended `visibleToPlayers=false`
// form field. Accepting the literal 'true'/'false' strings (or a real
// boolean, for forward-compatibility with a JSON caller) and transforming
// explicitly avoids that trap.
//
// asset_type is NOT a client-supplied field: this phase only ever writes
// asset_type='image' (see services/assets.ts) — 'handout' is reserved for a
// later phase, so there is nothing for a caller to choose yet.
export const createAssetFieldsSchema = z.object({
  characterId: z.coerce.number().int().positive().optional(),
  title: z.string().min(1).max(200).optional(),
  visibleToPlayers: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .transform((v) => (typeof v === 'string' ? v === 'true' : v))
    .optional(),
});
export type CreateAssetFieldsInput = z.infer<typeof createAssetFieldsSchema>;

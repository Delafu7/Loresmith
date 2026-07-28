import { z } from 'zod';

// See schemas/characters.ts for why defaulted fields live only on the create
// schema (zod's `.partial()` doesn't strip `.default()`).
const sharedCharacterItemShape = {
  itemId: z.string().uuid(),
  quantity: z.number().int().min(0),
  isEquipped: z.boolean(),
  isAttuned: z.boolean(),
  customName: z.string().max(200).optional().nullable(),
  chargesRemaining: z.number().int().min(0).optional().nullable(),
  notes: z.string().max(5000).optional().nullable(),
};

export const createCharacterItemSchema = z.object(sharedCharacterItemShape).extend({
  quantity: z.number().int().min(0).default(1),
  isEquipped: z.boolean().default(false),
  isAttuned: z.boolean().default(false),
});
export type CreateCharacterItemInput = z.infer<typeof createCharacterItemSchema>;

// itemId (which catalog item this row is) is not patchable — swapping the
// underlying template on an owned inventory line isn't a real operation;
// that's a delete + re-add.
export const updateCharacterItemSchema = z.object(sharedCharacterItemShape).omit({ itemId: true }).partial();
export type UpdateCharacterItemInput = z.infer<typeof updateCharacterItemSchema>;

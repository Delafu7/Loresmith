import { z } from 'zod';

// Generic category listing — entityType is a free string on purpose (see
// db/migrations/1784269786666_create-campaign-categories.ts's header
// comment), not a zod enum, so Task 2/3/5's new entity types (character,
// item, shop, map) never require a schema change here.
export const listCategoriesQuerySchema = z.object({
  entityType: z.string().min(1).max(50),
});
export type ListCategoriesQuery = z.infer<typeof listCategoriesQuerySchema>;

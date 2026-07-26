import { z } from 'zod';

// fieldKey isn't validated against the registry here — src/domain/
// revealFields.ts's list differs per entity type (character vs. monster
// instance), and this schema is shared by both routes. The service layer
// checks each fieldKey against revealableFieldsFor(entityType) and throws
// VALIDATION_ERROR for anything not on that entity's list, same "app-layer,
// not declarative" precedent as the field_key column's comment in the
// entity_field_reveals migration.
export const revealFieldUpdateSchema = z.object({
  fieldKey: z.string().min(1).max(100),
  revealed: z.boolean(),
  playerOverride: z.string().max(500).optional().nullable(),
});

export const updateRevealsSchema = z.object({
  fields: z.array(revealFieldUpdateSchema).min(1).max(50),
});
export type UpdateRevealsInput = z.infer<typeof updateRevealsSchema>;

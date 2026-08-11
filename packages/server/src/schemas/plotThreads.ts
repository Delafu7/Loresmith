import { z } from 'zod';

export const createPlotThreadSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(20000).optional().nullable(),
  originSessionId: z.string().uuid().optional().nullable(),
});
export type CreatePlotThreadInput = z.infer<typeof createPlotThreadSchema>;

export const updatePlotThreadSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(20000).optional().nullable(),
  status: z.enum(['open', 'resolved']).optional(),
  originSessionId: z.string().uuid().optional().nullable(),
});
export type UpdatePlotThreadInput = z.infer<typeof updatePlotThreadSchema>;

export const setPlotThreadVisibilitySchema = z.object({
  userIds: z.array(z.string().uuid()),
});
export type SetPlotThreadVisibilityInput = z.infer<typeof setPlotThreadVisibilitySchema>;

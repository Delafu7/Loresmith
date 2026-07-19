import { z } from 'zod';

export const registerSchema = z.object({
  email: z.string().email(),
  displayName: z.string().min(1).max(200),
  password: z.string().min(8).max(200),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
export type LoginInput = z.infer<typeof loginSchema>;

// Customizable Styles per Role (Phase 3.9) — a small dedicated endpoint
// rather than folding into a generic profile PATCH (this app has no such
// endpoint yet), matching the armor-class-mode/exhaustion precedent for a
// single-field toggle.
export const uiThemeEnum = z.enum(['crimson', 'amber']);
export const updateThemeSchema = z.object({
  uiTheme: uiThemeEnum,
});
export type UpdateThemeInput = z.infer<typeof updateThemeSchema>;

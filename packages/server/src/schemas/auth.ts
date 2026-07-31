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
export const uiThemeEnum = z.enum(['crimson', 'amber', 'ember']);
export const updateThemeSchema = z.object({
  uiTheme: uiThemeEnum,
});
export type UpdateThemeInput = z.infer<typeof updateThemeSchema>;

// Interface language (i18n first pass: nav/dashboard/auth screens) — same
// small-dedicated-endpoint precedent as uiTheme above, not folded into a
// generic profile PATCH.
export const localeEnum = z.enum(['en', 'es', 'fr']);
export const updateLocaleSchema = z.object({
  locale: localeEnum,
});
export type UpdateLocaleInput = z.infer<typeof updateLocaleSchema>;

// My Profile (nav point 6) — account details. Both fields optional
// independently (a display-name-only edit shouldn't require re-sending the
// unchanged email), but at least one must be present.
export const updateProfileSchema = z
  .object({
    displayName: z.string().min(1).max(200).optional(),
    email: z.string().email().optional(),
  })
  .refine((v) => v.displayName !== undefined || v.email !== undefined, {
    message: 'At least one of displayName or email is required',
  });
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

export const updatePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(200),
});
export type UpdatePasswordInput = z.infer<typeof updatePasswordSchema>;

// Accessibility (nav point 6) — the one preference this pass actually backs
// with a real effect (see the migration's own note on why no notifications
// toggle is added alongside it).
export const textSizeEnum = z.enum(['normal', 'large']);
export const updateTextSizeSchema = z.object({
  textSize: textSizeEnum,
});
export type UpdateTextSizeInput = z.infer<typeof updateTextSizeSchema>;

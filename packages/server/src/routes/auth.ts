import fs from 'node:fs';
import { Router } from 'express';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { handleAvatarUpload } from '../middleware/upload.js';
import { AppError } from '../middleware/errors.js';
import {
  loginSchema,
  registerSchema,
  updateThemeSchema,
  updateLocaleSchema,
  updateProfileSchema,
  updatePasswordSchema,
  updateTextSizeSchema,
  updateUnitSystemSchema,
} from '../schemas/auth.js';
import * as authService from '../services/auth.js';

export const authRouter = Router();

authRouter.post('/register', async (req, res) => {
  const input = registerSchema.parse(req.body);
  const user = await authService.register(pool, input);
  req.session.userId = user.id;
  res.status(201).json({ user });
});

authRouter.post('/login', async (req, res) => {
  const input = loginSchema.parse(req.body);
  const user = await authService.login(pool, input);
  req.session.userId = user.id;
  res.json({ user });
});

authRouter.post('/logout', (req, res, next) => {
  req.session.destroy((err) => {
    if (err) {
      next(err);
      return;
    }
    res.clearCookie('connect.sid');
    res.status(204).send();
  });
});

authRouter.get('/me', requireAuth, async (req, res) => {
  const memberships = await authService.getMemberships(pool, req.user!.id);
  res.json({ user: req.user, memberships });
});

// Customizable Styles per Role (Phase 3.9) — a personal preference, not tied
// to any campaign/role, so this is requireAuth-only: no campaign membership
// or DM check applies to changing your own theme.
authRouter.patch('/me/theme', requireAuth, async (req, res) => {
  const input = updateThemeSchema.parse(req.body);
  const user = await authService.updateTheme(pool, req.user!.id, input);
  res.json({ user });
});

// Interface language — same "personal preference, requireAuth-only" shape
// as /me/theme above.
authRouter.patch('/me/locale', requireAuth, async (req, res) => {
  const input = updateLocaleSchema.parse(req.body);
  const user = await authService.updateLocale(pool, req.user!.id, input);
  res.json({ user });
});

// "Larger text" accessibility preference — same personal-preference shape.
authRouter.patch('/me/text-size', requireAuth, async (req, res) => {
  const input = updateTextSizeSchema.parse(req.body);
  const user = await authService.updateTextSize(pool, req.user!.id, input);
  res.json({ user });
});

// Distance-unit preference — same personal-preference shape as /me/text-size.
authRouter.patch('/me/unit-system', requireAuth, async (req, res) => {
  const input = updateUnitSystemSchema.parse(req.body);
  const user = await authService.updateUnitSystem(pool, req.user!.id, input);
  res.json({ user });
});

// My Profile "Account" tab (nav point 6).
authRouter.patch('/me/profile', requireAuth, async (req, res) => {
  const input = updateProfileSchema.parse(req.body);
  const user = await authService.updateProfile(pool, req.user!.id, input);
  res.json({ user });
});

authRouter.patch('/me/password', requireAuth, async (req, res) => {
  const input = updatePasswordSchema.parse(req.body);
  await authService.updatePassword(pool, req.user!.id, input);
  res.status(204).send();
});

authRouter.post('/me/avatar', requireAuth, handleAvatarUpload, async (req, res) => {
  const file = req.file;
  try {
    if (!file) {
      throw new AppError('VALIDATION_ERROR', 'A file is required (multipart field name: "file")');
    }
    const fileUrl = `/uploads/users/${req.user!.id}/${file.filename}`;
    const user = await authService.updateAvatar(pool, req.user!.id, fileUrl);
    res.status(201).json({ user });
  } catch (err) {
    if (file) fs.unlink(file.path, () => {});
    throw err;
  }
});

authRouter.delete('/me/avatar', requireAuth, async (req, res) => {
  const user = await authService.updateAvatar(pool, req.user!.id, null);
  res.json({ user });
});

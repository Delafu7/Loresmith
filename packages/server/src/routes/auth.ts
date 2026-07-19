import { Router } from 'express';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { loginSchema, registerSchema, updateThemeSchema } from '../schemas/auth.js';
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

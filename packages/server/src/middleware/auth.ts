// requireAuth: verifies the Redis-backed session cookie carries a logged-in
// user and attaches the current user row to req.user. This is layer 1 of the
// layered authorization model (PLAN.md §4): authenticate -> campaign member
// -> role -> ownership.

import type { NextFunction, Request, Response } from 'express';
import { pool } from '../db/pool.js';
import { AppError } from './errors.js';

export interface AuthedUser {
  id: string;
  email: string;
  displayName: string;
  uiTheme: 'crimson' | 'amber' | 'ember' | 'arcane';
  locale: 'en' | 'es' | 'fr';
  avatarUrl: string | null;
  textSize: 'normal' | 'large';
  unitSystem: 'imperial' | 'metric';
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthedUser;
    }
  }
}

export async function requireAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const userId = req.session.userId;
  if (!userId) {
    throw new AppError('UNAUTHENTICATED', 'You must be logged in to do that');
  }

  const result = await pool.query<{
    id: string;
    email: string;
    display_name: string;
    ui_theme: 'crimson' | 'amber' | 'ember' | 'arcane';
    locale: 'en' | 'es' | 'fr';
    avatar_url: string | null;
    text_size: 'normal' | 'large';
    unit_system: 'imperial' | 'metric';
  }>(
    `SELECT id, email, display_name, ui_theme, locale, avatar_url, text_size, unit_system FROM users WHERE id = $1`,
    [userId],
  );
  const row = result.rows[0];
  if (!row) {
    // Session points at a user that no longer exists — treat as logged out.
    req.session.userId = undefined;
    throw new AppError('UNAUTHENTICATED', 'Session is no longer valid');
  }

  req.user = {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    uiTheme: row.ui_theme,
    locale: row.locale,
    avatarUrl: row.avatar_url,
    textSize: row.text_size,
    unitSystem: row.unit_system,
  };
  next();
}

import bcrypt from 'bcrypt';
import type { Pool } from 'pg';
import { AppError } from '../middleware/errors.js';
import type { LoginInput, RegisterInput, UpdateThemeInput, UpdateLocaleInput } from '../schemas/auth.js';

const BCRYPT_ROUNDS = 10;

export interface UserRow {
  id: string;
  email: string;
  displayName: string;
  uiTheme: 'crimson' | 'amber' | 'ember';
  locale: 'en' | 'es' | 'fr';
}

export interface MembershipSummary {
  campaignId: string;
  campaignName: string;
  role: 'dm' | 'player';
}

interface RawUserRow {
  id: string;
  email: string;
  display_name: string;
  ui_theme: 'crimson' | 'amber' | 'ember';
  locale: 'en' | 'es' | 'fr';
}

function toUserRow(row: RawUserRow): UserRow {
  return { id: row.id, email: row.email, displayName: row.display_name, uiTheme: row.ui_theme, locale: row.locale };
}

export async function register(pool: Pool, input: RegisterInput): Promise<UserRow> {
  const existing = await pool.query(`SELECT id FROM users WHERE email = $1`, [input.email]);
  if (existing.rows.length > 0) {
    throw new AppError('CONFLICT', 'An account with that email already exists');
  }

  const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);
  const result = await pool.query<RawUserRow>(
    `INSERT INTO users (email, display_name, password_hash) VALUES ($1, $2, $3)
     RETURNING id, email, display_name, ui_theme, locale`,
    [input.email, input.displayName, passwordHash],
  );
  return toUserRow(result.rows[0]!);
}

export async function login(pool: Pool, input: LoginInput): Promise<UserRow> {
  const result = await pool.query<RawUserRow & { password_hash: string }>(
    `SELECT id, email, display_name, password_hash, ui_theme, locale FROM users WHERE email = $1`,
    [input.email],
  );
  const row = result.rows[0];
  if (!row) {
    throw new AppError('UNAUTHENTICATED', 'Invalid email or password');
  }

  const matches = await bcrypt.compare(input.password, row.password_hash);
  if (!matches) {
    throw new AppError('UNAUTHENTICATED', 'Invalid email or password');
  }

  return toUserRow(row);
}

export async function updateTheme(pool: Pool, userId: string, input: UpdateThemeInput): Promise<UserRow> {
  const result = await pool.query<RawUserRow>(
    `UPDATE users SET ui_theme = $1 WHERE id = $2 RETURNING id, email, display_name, ui_theme, locale`,
    [input.uiTheme, userId],
  );
  return toUserRow(result.rows[0]!);
}

export async function updateLocale(pool: Pool, userId: string, input: UpdateLocaleInput): Promise<UserRow> {
  const result = await pool.query<RawUserRow>(
    `UPDATE users SET locale = $1 WHERE id = $2 RETURNING id, email, display_name, ui_theme, locale`,
    [input.locale, userId],
  );
  return toUserRow(result.rows[0]!);
}

export async function getMemberships(pool: Pool, userId: string): Promise<MembershipSummary[]> {
  const result = await pool.query<{ campaign_id: string; campaign_name: string; role: 'dm' | 'player' }>(
    `SELECT c.id AS campaign_id, c.name AS campaign_name, cm.role
     FROM campaign_members cm
     JOIN campaigns c ON c.id = cm.campaign_id
     WHERE cm.user_id = $1
     ORDER BY c.created_at DESC`,
    [userId],
  );
  return result.rows.map((r) => ({ campaignId: r.campaign_id, campaignName: r.campaign_name, role: r.role }));
}

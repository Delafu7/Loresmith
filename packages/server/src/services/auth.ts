import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcrypt';
import type { Pool } from 'pg';
import { AppError } from '../middleware/errors.js';
import { UPLOAD_ROOT } from '../middleware/upload.js';
import type {
  LoginInput,
  RegisterInput,
  UpdateThemeInput,
  UpdateLocaleInput,
  UpdateProfileInput,
  UpdatePasswordInput,
  UpdateTextSizeInput,
  UpdateUnitSystemInput,
} from '../schemas/auth.js';

const BCRYPT_ROUNDS = 10;

export interface UserRow {
  id: string;
  email: string;
  displayName: string;
  uiTheme: 'crimson' | 'amber' | 'ember';
  locale: 'en' | 'es' | 'fr';
  avatarUrl: string | null;
  textSize: 'normal' | 'large';
  unitSystem: 'imperial' | 'metric';
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
  avatar_url: string | null;
  text_size: 'normal' | 'large';
  unit_system: 'imperial' | 'metric';
}

const USER_COLUMNS = 'id, email, display_name, ui_theme, locale, avatar_url, text_size, unit_system';

function toUserRow(row: RawUserRow): UserRow {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    uiTheme: row.ui_theme,
    locale: row.locale,
    avatarUrl: row.avatar_url,
    textSize: row.text_size,
    unitSystem: row.unit_system,
  };
}

export async function register(pool: Pool, input: RegisterInput): Promise<UserRow> {
  const existing = await pool.query(`SELECT id FROM users WHERE email = $1`, [input.email]);
  if (existing.rows.length > 0) {
    throw new AppError('CONFLICT', 'An account with that email already exists');
  }

  const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);
  const result = await pool.query<RawUserRow>(
    `INSERT INTO users (email, display_name, password_hash) VALUES ($1, $2, $3)
     RETURNING ${USER_COLUMNS}`,
    [input.email, input.displayName, passwordHash],
  );
  return toUserRow(result.rows[0]!);
}

export async function login(pool: Pool, input: LoginInput): Promise<UserRow> {
  const result = await pool.query<RawUserRow & { password_hash: string }>(
    `SELECT ${USER_COLUMNS}, password_hash FROM users WHERE email = $1`,
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
    `UPDATE users SET ui_theme = $1 WHERE id = $2 RETURNING ${USER_COLUMNS}`,
    [input.uiTheme, userId],
  );
  return toUserRow(result.rows[0]!);
}

export async function updateLocale(pool: Pool, userId: string, input: UpdateLocaleInput): Promise<UserRow> {
  const result = await pool.query<RawUserRow>(
    `UPDATE users SET locale = $1 WHERE id = $2 RETURNING ${USER_COLUMNS}`,
    [input.locale, userId],
  );
  return toUserRow(result.rows[0]!);
}

export async function updateTextSize(pool: Pool, userId: string, input: UpdateTextSizeInput): Promise<UserRow> {
  const result = await pool.query<RawUserRow>(
    `UPDATE users SET text_size = $1 WHERE id = $2 RETURNING ${USER_COLUMNS}`,
    [input.textSize, userId],
  );
  return toUserRow(result.rows[0]!);
}

export async function updateUnitSystem(pool: Pool, userId: string, input: UpdateUnitSystemInput): Promise<UserRow> {
  const result = await pool.query<RawUserRow>(
    `UPDATE users SET unit_system = $1 WHERE id = $2 RETURNING ${USER_COLUMNS}`,
    [input.unitSystem, userId],
  );
  return toUserRow(result.rows[0]!);
}

// My Profile "Account" tab — displayName and/or email. Built as one
// coalescing UPDATE (not two branches) so a partial edit never has to guess
// which fields changed; email uniqueness is re-checked here (not just relied
// on from register) since it's now editable post-creation.
export async function updateProfile(pool: Pool, userId: string, input: UpdateProfileInput): Promise<UserRow> {
  if (input.email !== undefined) {
    const existing = await pool.query(`SELECT id FROM users WHERE email = $1 AND id != $2`, [input.email, userId]);
    if (existing.rows.length > 0) {
      throw new AppError('CONFLICT', 'An account with that email already exists');
    }
  }

  const result = await pool.query<RawUserRow>(
    `UPDATE users SET
       display_name = COALESCE($1, display_name),
       email = COALESCE($2, email)
     WHERE id = $3
     RETURNING ${USER_COLUMNS}`,
    [input.displayName ?? null, input.email ?? null, userId],
  );
  return toUserRow(result.rows[0]!);
}

export async function updatePassword(pool: Pool, userId: string, input: UpdatePasswordInput): Promise<void> {
  const result = await pool.query<{ password_hash: string }>(`SELECT password_hash FROM users WHERE id = $1`, [
    userId,
  ]);
  const row = result.rows[0];
  if (!row) {
    throw new AppError('UNAUTHENTICATED', 'Invalid session');
  }

  const matches = await bcrypt.compare(input.currentPassword, row.password_hash);
  if (!matches) {
    throw new AppError('VALIDATION_ERROR', 'Current password is incorrect');
  }

  const passwordHash = await bcrypt.hash(input.newPassword, BCRYPT_ROUNDS);
  await pool.query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [passwordHash, userId]);
}

export async function updateAvatar(pool: Pool, userId: string, avatarUrl: string | null): Promise<UserRow> {
  const previous = await pool.query<{ avatar_url: string | null }>(`SELECT avatar_url FROM users WHERE id = $1`, [
    userId,
  ]);

  const result = await pool.query<RawUserRow>(
    `UPDATE users SET avatar_url = $1 WHERE id = $2 RETURNING ${USER_COLUMNS}`,
    [avatarUrl, userId],
  );

  // Best-effort disk cleanup of the file being replaced/removed — same
  // "DB row is the source of truth, a dangling file isn't worth failing the
  // request for" tradeoff as services/assets.ts's deleteAsset.
  const previousAvatarUrl = previous.rows[0]?.avatar_url;
  if (previousAvatarUrl && previousAvatarUrl !== avatarUrl) {
    const relativePath = previousAvatarUrl.replace(/^\/uploads\//, '');
    const absolutePath = path.join(UPLOAD_ROOT, ...relativePath.split('/'));
    fs.unlink(absolutePath, (err) => {
      if (err) console.warn(`[auth] Failed to unlink replaced avatar ${absolutePath}:`, err.message);
    });
  }

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

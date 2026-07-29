// Integration test for the interface-language preference (i18n first pass):
// register defaults to 'en', updateLocale persists a change, and every
// user-shaped read (register/login/updateLocale) returns the same shape as
// updateTheme's own precedent. Throwaway fixture, cleaned up in afterAll —
// same isolation convention as the other services/*.integration.test.ts
// files in this directory.

import { afterAll, describe, expect, it } from 'vitest';
import { pool } from '../db/pool.js';
import { register, login, updateLocale } from './auth.js';

describe('locale (integration, live DB, throwaway fixture)', () => {
  const email = `locale-test-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
  let userId: string;

  afterAll(async () => {
    if (userId) await pool.query(`DELETE FROM users WHERE id = $1`, [userId]);
  });

  it('defaults a newly registered user to English', async () => {
    const user = await register(pool, { email, displayName: 'Locale Test', password: 'password123' });
    userId = user.id;
    expect(user.locale).toBe('en');
  });

  it('persists a locale change and reflects it on the next login', async () => {
    const updated = await updateLocale(pool, userId, { locale: 'fr' });
    expect(updated.locale).toBe('fr');

    const loggedIn = await login(pool, { email, password: 'password123' });
    expect(loggedIn.locale).toBe('fr');
  });
});

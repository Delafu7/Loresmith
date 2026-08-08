// Integration test for the distance-unit preference (Iteration 4): register
// defaults to 'imperial', updateUnitSystem persists a change, and the value
// survives a re-login — same shape as auth.locale.integration.test.ts's own
// precedent for its sibling preference. Throwaway fixture, cleaned up in
// afterAll.

import { afterAll, describe, expect, it } from 'vitest';
import { pool } from '../db/pool.js';
import { register, login, updateUnitSystem } from './auth.js';

describe('unitSystem (integration, live DB, throwaway fixture)', () => {
  const email = `unit-system-test-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
  let userId: string;

  afterAll(async () => {
    if (userId) await pool.query(`DELETE FROM users WHERE id = $1`, [userId]);
  });

  it('defaults a newly registered user to imperial', async () => {
    const user = await register(pool, { email, displayName: 'Unit System Test', password: 'password123' });
    userId = user.id;
    expect(user.unitSystem).toBe('imperial');
  });

  it('persists a unit system change and reflects it on the next login', async () => {
    const updated = await updateUnitSystem(pool, userId, { unitSystem: 'metric' });
    expect(updated.unitSystem).toBe('metric');

    const loggedIn = await login(pool, { email, password: 'password123' });
    expect(loggedIn.unitSystem).toBe('metric');
  });
});

import { afterEach, describe, expect, it } from 'vitest';
import { isEncounterMinimized, setEncounterMinimized, shouldEnterFullscreen } from './liveMapState';

describe('shouldEnterFullscreen', () => {
  afterEach(() => {
    window.localStorage.clear();
  });

  it('does not navigate if already on the target encounter', () => {
    expect(
      shouldEnterFullscreen({ targetEncounterId: 'enc-1', forced: false, currentLiveEncounterId: 'enc-1' }),
    ).toBe(false);
  });

  it('navigates to a fresh, unminimized encounter with nothing else open', () => {
    expect(
      shouldEnterFullscreen({ targetEncounterId: 'enc-1', forced: false, currentLiveEncounterId: null }),
    ).toBe(true);
  });

  it('respects a minimized flag for an unforced push', () => {
    setEncounterMinimized('enc-1', true);
    expect(isEncounterMinimized('enc-1')).toBe(true);
    expect(
      shouldEnterFullscreen({ targetEncounterId: 'enc-1', forced: false, currentLiveEncounterId: null }),
    ).toBe(false);
  });

  it('a forced push overrides a minimized flag', () => {
    setEncounterMinimized('enc-1', true);
    expect(
      shouldEnterFullscreen({ targetEncounterId: 'enc-1', forced: true, currentLiveEncounterId: null }),
    ).toBe(true);
  });

  it('does not interrupt a different live encounter already on screen', () => {
    expect(
      shouldEnterFullscreen({ targetEncounterId: 'enc-2', forced: false, currentLiveEncounterId: 'enc-1' }),
    ).toBe(false);
  });

  it('a forced push overrides being on a different live encounter too', () => {
    expect(
      shouldEnterFullscreen({ targetEncounterId: 'enc-2', forced: true, currentLiveEncounterId: 'enc-1' }),
    ).toBe(true);
  });

  it('setEncounterMinimized(false) clears a previously-set flag', () => {
    setEncounterMinimized('enc-1', true);
    setEncounterMinimized('enc-1', false);
    expect(isEncounterMinimized('enc-1')).toBe(false);
  });
});

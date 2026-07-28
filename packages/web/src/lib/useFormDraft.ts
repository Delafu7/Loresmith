import { useEffect, useState } from 'react';

/**
 * Drop-in replacement for `useState` that persists its value to
 * localStorage under `key` on every change, and restores it (instead of
 * `initial`) on mount if a draft is already there — so navigating away from
 * a long form mid-fill and coming back doesn't lose what was typed. Callers
 * should call the returned `clearDraft()` once a submit actually succeeds.
 *
 * Only meant for CREATE forms: `key` should be stable for the lifetime of
 * one in-progress creation (e.g. scoped by campaignId + entity type), not
 * reused across unrelated drafts.
 */
export function useFormDraft<T>(key: string, initial: T | (() => T)) {
  // Computed once, from the lazy useState initializer only — not meant to
  // stay reactive, just tells the caller whether the value it got back on
  // THIS mount came from a resumed draft (so it can e.g. skip clobbering it
  // with freshly-fetched server data).
  const [hadDraft] = useState(() => {
    try {
      return localStorage.getItem(key) !== null;
    } catch {
      return false;
    }
  });

  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw !== null) return JSON.parse(raw) as T;
    } catch {
      // Corrupt or inaccessible draft — fall through to the real initial value.
    }
    return initial instanceof Function ? initial() : initial;
  });

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Storage full/unavailable (private browsing etc.) — draft persistence
      // is best-effort, never a hard requirement for the form to work.
    }
  }, [key, value]);

  function clearDraft() {
    try {
      localStorage.removeItem(key);
    } catch {
      // Best-effort, same as above.
    }
  }

  return [value, setValue, clearDraft, hadDraft] as const;
}

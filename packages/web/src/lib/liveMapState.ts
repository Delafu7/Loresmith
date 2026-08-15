// Map-first encounter system — client-side state for the fullscreen live
// map: which encounters this browser has "minimized" out of (persisted per
// the confirmed product decision that minimizing survives reload/reconnect
// until the player re-enters or the DM forces everyone back), plus the pure
// decision of whether a just-received push should actually navigate. Pulled
// out as plain functions, no React/router import, so the branching is
// testable without mounting anything — same precedent as canMoveToken.ts and
// services/encounters.ts's computeNextTurn on the server.

const STORAGE_PREFIX = 'live-map-minimized:';

// VTT roster sidebar (PartyStatsSidebar) collapse state — a global per-user
// preference (not per-encounter, unlike minimized above), same
// fail-open-on-storage-error shape. Defaults to visible (no stored key) per
// the product requirement that the sidebar is present by default and only
// hides on an explicit user action.
const SIDEBAR_COLLAPSED_KEY = 'vtt-sidebar-collapsed';

export function isSidebarCollapsed(): boolean {
  try {
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

export function setSidebarCollapsed(collapsed: boolean): void {
  try {
    if (collapsed) {
      window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, '1');
    } else {
      window.localStorage.removeItem(SIDEBAR_COLLAPSED_KEY);
    }
  } catch {
    // Ignore — worst case the choice doesn't persist this session.
  }
}

export function isEncounterMinimized(encounterId: string): boolean {
  try {
    return window.localStorage.getItem(STORAGE_PREFIX + encounterId) === '1';
  } catch {
    // Private-browsing / storage-disabled — fail open (never minimized)
    // rather than crash the listener.
    return false;
  }
}

export function setEncounterMinimized(encounterId: string, minimized: boolean): void {
  try {
    if (minimized) {
      window.localStorage.setItem(STORAGE_PREFIX + encounterId, '1');
    } else {
      window.localStorage.removeItem(STORAGE_PREFIX + encounterId);
    }
  } catch {
    // Ignore — worst case the player has to minimize again next session.
  }
}

/**
 * Whether a push (or an on-mount "am I relevant to a live encounter" check)
 * should actually navigate the browser to the fullscreen map right now.
 * `forced` (the DM's "force everyone back to fullscreen" control) always
 * wins — it's the one thing that overrides a player's own minimized choice.
 * Otherwise: respect an explicit minimize, and never interrupt a DIFFERENT
 * live encounter already on screen (confirmed product decision — only
 * players newly relevant to the new one get pushed; whoever's mid-something
 * elsewhere stays put).
 */
export function shouldEnterFullscreen({
  targetEncounterId,
  forced,
  currentLiveEncounterId,
}: {
  targetEncounterId: string;
  forced: boolean;
  /** The encounterId segment of the current /live/:id route, or null if not on one. */
  currentLiveEncounterId: string | null;
}): boolean {
  if (currentLiveEncounterId === targetEncounterId) return false; // already there
  if (forced) return true;
  if (currentLiveEncounterId !== null) return false; // don't interrupt a different live encounter
  return !isEncounterMinimized(targetEncounterId);
}

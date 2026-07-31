import { useEffect } from 'react';

// Nav point 7: browser-back / mobile swipe-back must close an open
// modal/overlay instead of leaving the app (neither a <dialog> nor a plain
// fixed-position drawer has a history entry of its own). Push a marker
// history entry while open; a real back navigation pops it and fires
// 'popstate', which we translate into onClose(). If the overlay is instead
// closed via its own UI (X, Escape, backdrop), the cleanup below consumes
// that same pushed entry with one history.back() so the history stack
// doesn't accumulate stale entries — guarded by checking that our marker is
// still the current state, so a real back navigation (which already popped
// it) never gets double-consumed. Single global history.state means this
// assumes at most one dismissible overlay (Modal or otherwise) open at a
// time, true for every call site in this app today.
export function useHistoryDismiss(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    window.history.pushState({ dismissibleOverlayOpen: true }, '');
    function onPopState() {
      onClose();
    }
    window.addEventListener('popstate', onPopState);
    return () => {
      window.removeEventListener('popstate', onPopState);
      if ((window.history.state as { dismissibleOverlayOpen?: boolean } | null)?.dismissibleOverlayOpen) {
        window.history.back();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
}

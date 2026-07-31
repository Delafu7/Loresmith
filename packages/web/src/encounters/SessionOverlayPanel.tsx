// Floating drawer used by SessionScreen.tsx for the participant sheet,
// DM/player controls, combat log, and chat — deliberately NOT a resizable
// side panel (see the map-first redesign this replaced): it floats OVER the
// map, which always keeps its full width/height underneath. Backdrop click,
// Escape, the panel's own ✕, and browser-back/swipe-back (useHistoryDismiss,
// same mechanism as Modal.tsx) all close it the same way. Not <dialog>-based
// like Modal.tsx — this must float non-modally over the map, which a native
// <dialog> top-layer would fight with pointer-wise — so Escape is wired
// explicitly instead of coming for free from showModal().

import { useEffect, type ReactNode } from 'react';
import { useHistoryDismiss } from '../lib/useHistoryDismiss';
import { useLocale } from '../i18n/LocaleContext';

function useEscapeKey(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);
}

export function SessionOverlayPanel({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children?: ReactNode;
}) {
  const { t } = useLocale();
  useHistoryDismiss(open, onClose);
  useEscapeKey(open, onClose);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-stone-950/60" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : undefined}
        className="relative flex h-full w-[min(420px,100vw)] flex-col gap-3 overflow-y-auto bg-stone-900 p-3 shadow-2xl"
      >
        <div className="flex flex-shrink-0 items-center justify-between gap-2">
          <h2 className="font-display text-sm font-medium text-stone-100 truncate">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.close')}
            className="flex size-9 flex-shrink-0 items-center justify-center rounded-md text-stone-400 hover:bg-stone-800 hover:text-stone-100"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

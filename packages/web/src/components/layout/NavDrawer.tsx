import { useEffect, useRef, type ReactNode, type TouchEvent } from 'react';
import { useLocale } from '../../i18n/LocaleContext';
import { useHistoryDismiss } from '../../lib/useHistoryDismiss';

// Mobile-only slide-out nav drawer. Native <dialog> (via showModal()/close()),
// same "no headless-dialog dependency installed, use the platform primitive"
// choice Modal.tsx already made for the centered dialog case — showModal()
// gives focus trapping, Escape-to-close, top-layer stacking, and (on close())
// automatic focus restoration to whatever triggered it, all for free.
// useHistoryDismiss makes browser-back/swipe-back close it instead of
// leaving the app, same as Modal.tsx.
//
// Entrance slides in from the left via the `starting:` variant (CSS
// @starting-style — the standard way to animate an element's first paint
// after `display: none` -> shown, which a plain CSS transition can't do on
// its own). Exit is NOT animated (dialog.close() removes it immediately) —
// a deliberate scope cut; a JS-timed exit transition is real extra
// complexity for a close action that's already instant-feeling on a swipe
// or backdrop tap. `motion-reduce:` disables the entrance transition
// entirely for prefers-reduced-motion.
//
// Swipe-to-dismiss: a plain touchstart/touchend delta on the panel itself
// (not a drag-following gesture) — closes past a 60px leftward swipe,
// matching the "swipe/tap dismissible" requirement without pulling in a
// gesture library for one interaction.
export function NavDrawer({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  const { t } = useLocale();
  const ref = useRef<HTMLDialogElement>(null);
  const touchStartX = useRef<number | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  useHistoryDismiss(open, onClose);

  function onTouchStart(e: TouchEvent<HTMLDialogElement>) {
    touchStartX.current = e.touches[0]?.clientX ?? null;
  }
  function onTouchEnd(e: TouchEvent<HTMLDialogElement>) {
    if (touchStartX.current == null) return;
    const dx = (e.changedTouches[0]?.clientX ?? touchStartX.current) - touchStartX.current;
    touchStartX.current = null;
    if (dx < -60) onClose();
  }

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      aria-label={title}
      className="fixed inset-y-0 left-0 m-0 h-dvh max-h-dvh w-[min(300px,85vw)] max-w-none translate-x-0 rounded-none bg-stone-900 p-0 text-stone-100 shadow-2xl backdrop:bg-stone-950/60 transition-transform duration-200 ease-out starting:-translate-x-full motion-reduce:transition-none"
    >
      <div className="flex items-center justify-between gap-2 border-b border-stone-800 px-4 py-3">
        <span className="font-display text-sm font-medium truncate">{title}</span>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('common.close')}
          className="flex size-9 flex-none items-center justify-center rounded-md text-stone-400 hover:bg-stone-800 hover:text-stone-100"
        >
          ✕
        </button>
      </div>
      <div className="h-[calc(100%-3.25rem)] overflow-y-auto">{children}</div>
    </dialog>
  );
}

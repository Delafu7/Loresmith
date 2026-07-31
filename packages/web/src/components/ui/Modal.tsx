import { useEffect, useRef, type ReactNode } from 'react';
import { useLocale } from '../../i18n/LocaleContext';
import { useHistoryDismiss } from '../../lib/useHistoryDismiss';

export type ModalSize = 'sm' | 'lg';

const SIZE_CLASSES: Record<ModalSize, string> = {
  sm: 'w-[min(440px,calc(100vw-2rem))]',
  lg: 'w-[min(640px,calc(100vw-2rem))]',
};

/*
 * Modal (docs/design-tokens.md "Dialog / modal"). No headless-dialog
 * primitive is installed in this repo (see EffectApplyDialog.tsx's own note
 * — existing "dialogs" are inline collapsible panels, not true overlays),
 * so this uses the native <dialog> element instead of pulling in a
 * dependency: showModal()/close() give focus trapping, Escape-to-close, and
 * top-layer stacking for free, for zero JS beyond wiring `open` to the
 * imperative API React doesn't cover declaratively.
 */
export function Modal({
  open,
  onClose,
  title,
  size = 'sm',
  actions,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  size?: ModalSize;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  const { t } = useLocale();
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  // Nav point 7: browser-back / mobile swipe-back must close an open modal
  // instead of leaving the app (a <dialog> has no history entry of its own).
  useHistoryDismiss(open, onClose);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className={`${SIZE_CLASSES[size]} m-auto max-h-[85dvh] overflow-y-auto rounded-lg bg-stone-900 p-4 text-stone-100 shadow-lg backdrop:bg-stone-950/60 sm:p-6`}
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <h2 className="font-display text-lg font-medium">{title}</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('common.close')}
          className="flex size-9 flex-none items-center justify-center rounded-md text-stone-400 hover:bg-stone-800 hover:text-stone-100"
        >
          ✕
        </button>
      </div>
      {children}
      {actions ? <div className="mt-4 flex justify-end gap-2">{actions}</div> : null}
    </dialog>
  );
}

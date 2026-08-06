import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { useLocale } from '../../i18n/LocaleContext';

// This app's first toast component (Iteration 2, "Fast add/spawn UX" —
// undo-able removal). No toast/notification pattern existed anywhere before
// this; deliberately minimal (a stack of dismissible lines with an optional
// single action button) rather than a general notification-center, since
// that's all the one caller (AddToEncounterOverlay.tsx) needs today. Mounted
// once at the app root (App.tsx) so it's available to both route trees
// (CampaignShell and the fullscreen LiveMapPage, which live outside each
// other — see CampaignShell.tsx's own note on that split).

interface ToastAction {
  label: string;
  onClick: () => void;
}

interface ToastItem {
  id: string;
  message: string;
  action?: ToastAction;
}

interface ToastContextValue {
  showToast: (message: string, action?: ToastAction) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}

const AUTO_DISMISS_MS = 6000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const { t } = useLocale();
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const showToast = useCallback(
    (message: string, action?: ToastAction) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      setToasts((prev) => [...prev, { id, message, action }]);
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), AUTO_DISMISS_MS),
      );
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role="status"
            className="pointer-events-auto flex w-full max-w-sm items-center gap-3 rounded-md bg-stone-800 px-3 py-2 text-sm text-stone-100 shadow-lg"
          >
            <span className="min-w-0 flex-1 truncate">{toast.message}</span>
            {toast.action && (
              <button
                type="button"
                onClick={() => {
                  toast.action!.onClick();
                  dismiss(toast.id);
                }}
                className="flex-none font-semibold text-amber-400 hover:text-amber-300"
              >
                {toast.action.label}
              </button>
            )}
            <button
              type="button"
              onClick={() => dismiss(toast.id)}
              aria-label={t('common.close')}
              className="flex-none text-stone-500 hover:text-stone-300"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

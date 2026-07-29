import type { ReactNode } from 'react';
import { useLocale } from '../i18n/LocaleContext';

// `label` stays an explicit English override for the many call sites that
// pass a specific one ("Loading campaign…", etc.) — only the DEFAULT is
// translated (i18n first pass scope; see i18n/en.ts).
export function Loading({ label }: { label?: string }) {
  const { t } = useLocale();
  return (
    <div className="flex items-center justify-center gap-2 py-12 text-stone-400 text-sm" role="status">
      <span
        aria-hidden="true"
        className="size-3.5 animate-spin rounded-full border-2 border-stone-600 border-t-amber-500 motion-reduce:animate-none"
      />
      {label ?? t('common.loading')}
    </div>
  );
}

export function ErrorBanner({ message }: { message: string }) {
  return (
    <div role="alert" className="rounded-md border border-red-800 bg-red-950/50 text-red-300 text-sm px-4 py-3">
      {message}
    </div>
  );
}

/** Invented — the source has no empty-state example (docs/design-tokens.md). */
export function EmptyState({ message, action }: { message: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-md py-10 text-center">
      <p className="text-stone-500 text-sm italic">{message}</p>
      {action}
    </div>
  );
}

/**
 * Loading skeleton — invented (docs/design-tokens.md). Pulsing stone-800
 * blocks at the shape of the content they replace; a static block (no pulse)
 * under prefers-reduced-motion.
 */
export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-stone-800 motion-reduce:animate-none ${className}`} />;
}

export function CardSkeleton() {
  return (
    <div className="flex flex-col gap-2 rounded-md bg-stone-900 p-4 shadow-sm">
      <Skeleton className="h-4 w-2/3" />
      <Skeleton className="h-3 w-1/3" />
      <Skeleton className="h-3 w-full" />
    </div>
  );
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return 'Something went wrong';
}

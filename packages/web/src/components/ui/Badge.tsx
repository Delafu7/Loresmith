import type { HTMLAttributes, ReactNode } from 'react';

export type BadgeVariant = 'accent' | 'neutral' | 'outline' | 'danger';

/*
 * Tag/badge (docs/design-tokens.md "Badges / tags"). `accent`/`neutral` use
 * the app's existing 5-shade amber-950/amber-400 and 10-shade
 * stone-800/stone-100 slots (both already overridden per-theme) rather than
 * the source's literal accent-800/accent-100 pair — those aren't part of
 * this app's existing amber override set, and adding them would only be
 * correct under the "ember" theme, silently breaking under the untouched
 * "crimson"/"amber" alternates. `danger` isn't in the source; reuses the
 * app's existing red-800/red-400 convention (see Button.tsx).
 */
const VARIANT_CLASSES: Record<BadgeVariant, string> = {
  accent: 'bg-amber-950 text-amber-400',
  neutral: 'bg-stone-800 text-stone-100',
  outline: 'border border-amber-500 text-amber-500',
  danger: 'border border-red-800 text-red-400',
};

export function Badge({
  variant = 'neutral',
  children,
  className = '',
  ...rest
}: {
  variant?: BadgeVariant;
  children?: ReactNode;
} & HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] tracking-wide ${VARIANT_CLASSES[variant]} ${className}`}
      {...rest}
    >
      {children}
    </span>
  );
}

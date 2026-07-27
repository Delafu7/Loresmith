import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Link, type LinkProps } from 'react-router-dom';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'icon' | 'danger';
export type ButtonSize = 'sm' | 'md';

/*
 * Shared button (docs/design-tokens.md "Buttons"). The source design's
 * primary button is outline/ghost (transparent bg, accent border+text), not
 * a filled chip — a filled amber-600 background fails AA with text on top
 * (~4:1, see design-tokens.md "Contrast findings"), so this doesn't offer a
 * filled-bg variant at all. `disabled` is the source's one rule,
 * opacity-45 + not-allowed, applied identically to every variant.
 *
 * `danger` isn't in the source (no destructive-action example there) — it
 * reuses this app's existing red-800/red-400 convention (already used by
 * ErrorBanner and CampaignShell's "Hide everything" button) rather than
 * inventing a new hue, so destructive actions stay visually consistent with
 * what already shipped.
 */
const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    'border border-amber-500 text-amber-500 hover:bg-amber-500/10 active:bg-amber-500/20',
  secondary:
    'border border-stone-600 text-stone-200 hover:bg-stone-100/5 active:bg-stone-100/10',
  ghost: 'border border-transparent text-amber-500 hover:bg-amber-500/10 px-2',
  icon: 'border border-transparent text-stone-200 hover:bg-stone-100/10 p-0',
  danger:
    'border border-red-800 text-red-400 hover:bg-red-500/10 active:bg-red-500/15',
};

const SIZE_CLASSES: Record<ButtonVariant, Record<ButtonSize, string>> = {
  primary: { sm: 'px-3 py-1.5 text-xs', md: 'px-4 py-2 text-sm' },
  secondary: { sm: 'px-3 py-1.5 text-xs', md: 'px-4 py-2 text-sm' },
  ghost: { sm: 'py-1 text-xs', md: 'py-1.5 text-sm' },
  icon: { sm: 'size-9', md: 'size-11' },
  danger: { sm: 'px-3 py-1.5 text-xs', md: 'px-4 py-2 text-sm' },
};

const BASE =
  'inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors disabled:opacity-45 disabled:cursor-not-allowed disabled:pointer-events-none';

interface CommonProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
  children?: ReactNode;
  className?: string;
}

function classes({ variant = 'secondary', size = 'md', block, className }: CommonProps) {
  return [BASE, VARIANT_CLASSES[variant], SIZE_CLASSES[variant][size], block ? 'w-full' : '', className]
    .filter(Boolean)
    .join(' ');
}

type ButtonProps = CommonProps & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'>;

/** Native `<button>`. Defaults `type="button"` — most call sites are actions, not form submits. */
export function Button({ variant, size, block, className, type = 'button', ...rest }: ButtonProps) {
  return <button type={type} className={classes({ variant, size, block, className })} {...rest} />;
}

type ButtonLinkProps = CommonProps & Omit<LinkProps, 'className'>;

/** React Router `Link` styled as a button — for navigation, not actions. */
export function ButtonLink({ variant, size, block, className, ...rest }: ButtonLinkProps) {
  return <Link className={classes({ variant, size, block, className })} {...rest} />;
}

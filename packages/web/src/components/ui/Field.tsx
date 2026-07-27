import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';

/*
 * Form field (docs/design-tokens.md "Inputs"). The source's control border
 * is soft/decorative at rest (color-mix over the divider token) and
 * strengthens on hover/focus rather than being AA-solid by default — this
 * keeps that, but leans on the input's own background (stone-800, distinct
 * from the stone-900 card it usually sits in) plus the always-strong
 * :focus-visible ring (index.css) to carry the boundary, rather than
 * relying on the resting border alone.
 *
 * min-height is 44px (not the source's 36px) and text is 16px on mobile,
 * shrinking to 14px from `sm:` up — both are Phase 3 mobile non-negotiables
 * (iOS zooms on <16px inputs; touch targets need 44px) that override the
 * source's desktop-only figures.
 *
 * Validation error state isn't in the source (no error color defined at
 * all) — invented here as red-500 border + red-400 helper text, the same
 * existing red convention as Button's `danger` variant / ErrorBanner.
 */
const CONTROL_CLASSES =
  'w-full min-h-11 rounded-md border bg-stone-800 px-3 py-2 text-base text-stone-100 transition-colors placeholder:text-stone-500 sm:text-sm ' +
  'border-stone-700 hover:border-stone-500 focus-visible:border-amber-500 focus:outline-none disabled:opacity-45 disabled:cursor-not-allowed';
const CONTROL_ERROR_CLASSES = 'border-red-500 hover:border-red-400 focus-visible:border-red-400';

export function Field({
  label,
  htmlFor,
  error,
  hint,
  children,
  className = '',
}: {
  label: ReactNode;
  htmlFor: string;
  error?: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <label htmlFor={htmlFor} className="text-xs text-stone-400">
        {label}
      </label>
      {children}
      {error ? (
        <p className="text-xs text-red-400" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-stone-500">{hint}</p>
      ) : null}
    </div>
  );
}

type InputProps = InputHTMLAttributes<HTMLInputElement> & { error?: boolean };

export function Input({ error, className = '', ...rest }: InputProps) {
  return (
    <input
      className={`${CONTROL_CLASSES} ${error ? CONTROL_ERROR_CLASSES : ''} ${className}`}
      aria-invalid={error || undefined}
      {...rest}
    />
  );
}

type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & { error?: boolean };

export function Textarea({ error, className = '', ...rest }: TextareaProps) {
  return (
    <textarea
      className={`${CONTROL_CLASSES} min-h-24 resize-y ${error ? CONTROL_ERROR_CLASSES : ''} ${className}`}
      aria-invalid={error || undefined}
      {...rest}
    />
  );
}

type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & { error?: boolean };

export function Select({ error, className = '', children, ...rest }: SelectProps) {
  return (
    <select
      className={`${CONTROL_CLASSES} ${error ? CONTROL_ERROR_CLASSES : ''} ${className}`}
      aria-invalid={error || undefined}
      {...rest}
    >
      {children}
    </select>
  );
}

/** Convenience: `const id = useFieldId('email')` gives a stable, unique `htmlFor`/`id` pair. */
export function useFieldId(prefix: string): string {
  const raw = useId();
  return `${prefix}-${raw.replace(/[^a-zA-Z0-9]/g, '')}`;
}

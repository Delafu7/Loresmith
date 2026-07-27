import type { FormHTMLAttributes, HTMLAttributes, ReactNode } from 'react';

export type CardElevation = 'sm' | 'md' | 'lg';

const ELEVATION_CLASSES: Record<CardElevation, string> = {
  sm: 'shadow-sm',
  md: 'shadow-md',
  lg: 'shadow-lg',
};

/*
 * Card (docs/design-tokens.md "Cards"). The source draws card "borders" as a
 * 1px box-shadow ring (--shadow-sm/md/lg, overridden onto Tailwind's own
 * shadow-* theme slots in index.css) rather than a border property — no
 * `border` class here on purpose, matching the source exactly.
 */
type CardProps = {
  elevation?: CardElevation;
  interactive?: boolean;
  children?: ReactNode;
} & ({ as: 'form' } & FormHTMLAttributes<HTMLFormElement> | ({ as?: 'div' } & HTMLAttributes<HTMLDivElement>));

export function Card({ elevation = 'sm', interactive, className = '', children, as = 'div', ...rest }: CardProps) {
  const classes = `flex flex-col gap-2 rounded-md bg-stone-900 p-4 ${ELEVATION_CLASSES[elevation]} ${
    interactive ? 'cursor-pointer transition-colors hover:bg-stone-800/70' : ''
  } ${className}`;
  if (as === 'form') {
    return (
      <form className={classes} {...(rest as FormHTMLAttributes<HTMLFormElement>)}>
        {children}
      </form>
    );
  }
  return (
    <div className={classes} {...(rest as HTMLAttributes<HTMLDivElement>)}>
      {children}
    </div>
  );
}

export function CardKicker({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`text-[10px] uppercase tracking-wider text-amber-500 ${className}`}>{children}</div>
  );
}

export function CardTitle({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`font-display text-base font-medium leading-tight ${className}`}>{children}</div>;
}

export function CardBody({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <p className={`flex-1 text-xs text-stone-300 ${className}`}>{children}</p>;
}

export function CardMeta({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`flex items-center gap-1.5 text-[11px] text-stone-500 ${className}`}>{children}</div>
  );
}

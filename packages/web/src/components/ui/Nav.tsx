import type { ReactNode } from 'react';
import { NavLink, type NavLinkProps } from 'react-router-dom';

/*
 * Sidebar navigation (docs/design-tokens.md "Navigation"). The source's
 * real screens use a fixed left sidebar, not the generic top-nav bar also
 * defined in the foundation layer — icon+label rows, active item gets a
 * filled neutral-800 chip with a 2px accent left border and full-brightness
 * text, inactive items are transparent with muted text. This is what
 * CampaignShell's existing sidebar (previously bg-amber-600/text-stone-950,
 * which fails AA under the new palette — see design-tokens.md) migrates to.
 */
export function Sidebar({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <nav
      className={`flex flex-col gap-6 border-stone-800 px-4 py-4 max-md:border-b md:min-h-screen md:w-56 md:border-r ${className}`}
    >
      {children}
    </nav>
  );
}

export function NavItemList({ children }: { children: ReactNode }) {
  return <ul className="flex flex-col gap-1 max-md:flex-row max-md:flex-wrap">{children}</ul>;
}

export function NavItem({
  icon,
  children,
  ...rest
}: { icon?: ReactNode; children: ReactNode } & Omit<NavLinkProps, 'children'>) {
  return (
    <li>
      <NavLink
        {...rest}
        className={({ isActive }) =>
          `flex min-h-11 items-center gap-2.5 rounded-md border-l-2 px-3 py-2 text-sm font-medium transition-colors ${
            isActive
              ? 'border-amber-500 bg-stone-800 text-stone-100'
              : 'border-transparent text-stone-400 hover:bg-stone-800/60 hover:text-stone-200'
          }`
        }
      >
        {icon}
        <span>{children}</span>
      </NavLink>
    </li>
  );
}

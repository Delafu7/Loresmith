// Shared chrome for the global bestiary (REFACTOR-PLAN.md §1/§8): a
// top-level, cross-campaign entry point — distinct from the per-campaign
// "Bestiary" tab inside CampaignShell (kept as-is; that one manages a single
// campaign's homebrew + spawns instances into that campaign's encounters).
// This one is read/browse-first: Basic (global catalog) vs. Campaign-specific
// (homebrew, picked per campaign), each creature landing on its own
// `/creature/:id` sheet.

import { NavLink, Outlet } from 'react-router-dom';
import { useLocale } from '../i18n/LocaleContext';
import { useBreadcrumb } from '../components/layout/BreadcrumbContext';

export function BestiaryLayout() {
  const { t } = useLocale();
  useBreadcrumb(1, [{ label: t('nav.bestiary') }]);

  return (
    <div className="min-h-dvh bg-stone-950 text-stone-100">
      <header className="border-b border-stone-800 px-4 py-4 flex items-center justify-between flex-wrap gap-3 sm:px-6">
        <h1 className="font-display text-xl font-medium">{t('nav.bestiary')}</h1>
        <nav className="flex gap-1">
          <BestiaryTab to="/bestiary/basic" label={t('bestiary.layout.tabBasic')} />
          <BestiaryTab to="/bestiary/campaign" label={t('bestiary.layout.tabCampaign')} />
        </nav>
      </header>
      <main className="max-w-6xl mx-auto px-4 py-6 sm:py-8">
        <Outlet />
      </main>
    </div>
  );
}

function BestiaryTab({ to, label }: { to: string; label: string }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `flex min-h-11 items-center rounded-md px-3 text-sm font-medium transition-colors ${
          isActive ? 'bg-amber-950 text-amber-400' : 'text-stone-300 hover:bg-stone-800'
        }`
      }
    >
      {label}
    </NavLink>
  );
}

// Shared chrome for the personal compendium: a top-level, cross-campaign
// entry point for a GM's own authored content (races, items, spells, ...),
// reusable in every campaign they run — distinct from the per-campaign
// Catalog tab inside CampaignShell (catalog/CatalogEditorPage.tsx, unchanged;
// that one manages a single campaign's own homebrew). Mirrors
// bestiary/BestiaryLayout.tsx's role as a plain top-level entry point.
import { NavLink, Outlet } from 'react-router-dom';
import { useLocale } from '../i18n/LocaleContext';
import { useBreadcrumb } from '../components/layout/BreadcrumbContext';

export function CompendiumLayout() {
  const { t } = useLocale();
  useBreadcrumb(1, [{ label: t('nav.compendium') }]);

  return (
    <div className="min-h-dvh bg-stone-950 text-stone-100">
      <header className="border-b border-stone-800 px-4 py-4 flex items-center justify-between flex-wrap gap-3 sm:px-6">
        <h1 className="font-display text-xl font-medium">{t('nav.compendium')}</h1>
        <nav className="flex gap-1">
          <CompendiumTab to="/compendium" end label={t('catalog.list.heading')} />
          <CompendiumTab to="/compendium/items" label={t('items.list.heading')} />
        </nav>
      </header>
      <main className="max-w-6xl mx-auto px-4 py-6 sm:py-8">
        <Outlet />
      </main>
    </div>
  );
}

function CompendiumTab({ to, label, end }: { to: string; label: string; end?: boolean }) {
  return (
    <NavLink
      to={to}
      end={end}
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

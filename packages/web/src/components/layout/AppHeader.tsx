import { Link } from 'react-router-dom';
import { useLocale } from '../../i18n/LocaleContext';
import { Breadcrumbs } from './Breadcrumbs';
import { UserMenu } from './UserMenu';
import { useHeaderBadgeLabel } from './HeaderBadgeContext';
import { Badge } from '../ui/Badge';

/*
 * Persistent header (nav point 7: "a persistent header with a clickable
 * logo that always goes home ... present in every view"). Lives once in
 * AppLayout, above every authenticated route's <Outlet/>, replacing the 7+
 * separate ad hoc headers each top-level page used to render on its own.
 */
export function AppHeader() {
  const { t } = useLocale();
  const badgeLabel = useHeaderBadgeLabel();

  return (
    <header className="sticky top-0 z-10 flex items-center gap-4 border-b border-stone-800 bg-stone-950/95 px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur sm:px-6">
      {/* This group must own flex-1 itself, not rely on Breadcrumbs' own
          flex-1 to be present — Breadcrumbs renders nothing at all on a page
          with no registered trail (e.g. /home), which previously left no
          spacer at all and collapsed the avatar/badge group to the left
          instead of the right. */}
      <div className="flex min-w-0 flex-1 items-center gap-4">
        <Link
          to="/home"
          aria-label={t('nav.logoAria')}
          className="flex-shrink-0 font-display text-lg font-medium tracking-wide text-amber-500"
        >
          Loresmith
        </Link>
        <Breadcrumbs />
      </div>
      <div className="flex flex-shrink-0 items-center gap-3">
        {badgeLabel && (
          <Badge variant="outline" className="uppercase">
            {badgeLabel}
          </Badge>
        )}
        <UserMenu />
      </div>
    </header>
  );
}

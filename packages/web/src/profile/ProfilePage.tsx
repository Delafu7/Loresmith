import { useState } from 'react';
import { useLocale } from '../i18n/LocaleContext';
import { useBreadcrumb } from '../components/layout/BreadcrumbContext';
import { AccountTab } from './AccountTab';
import { PreferencesTab } from './PreferencesTab';

type ProfileTab = 'account' | 'preferences';

/*
 * My Profile (nav point 6) — a single dedicated place for account details
 * and app preferences, reached from the header's avatar menu (UserMenu.tsx),
 * replacing the theme/language pickers that used to live inline in
 * DashboardPage/CampaignShell/CampaignListPage and the inline pickers this
 * page's own predecessor kept in UserMenu's dropdown.
 *
 * Local tab state, not sub-routes — two tabs with no deep-linkable content
 * inside either one, so a route split would add complexity (breadcrumb
 * depth, back-button target) with no real benefit yet.
 */
export function ProfilePage() {
  const { t } = useLocale();
  const [tab, setTab] = useState<ProfileTab>('account');
  useBreadcrumb(1, [{ label: t('profile.title') }]);

  return (
    // Distinguishes this as its own "account settings" area rather than just
    // another content screen — a subtle warm gradient using the existing
    // amber-950 token, fading back to the app's normal bg-stone-950. Kept as
    // a gradient (not a flat bg-stone-900) specifically so it doesn't erase
    // the contrast the Card component relies on (Card is itself bg-stone-900).
    <div className="min-h-dvh bg-gradient-to-b from-amber-950/40 via-stone-950 to-stone-950">
      <div className="mx-auto max-w-2xl px-4 py-6 sm:py-8">
        <h1 className="font-display text-xl font-medium">{t('profile.title')}</h1>
        <nav className="mt-4 flex flex-wrap gap-1" aria-label={t('profile.tabsAria')}>
          <ProfileTabButton active={tab === 'account'} onClick={() => setTab('account')}>
            {t('profile.accountTab')}
          </ProfileTabButton>
          <ProfileTabButton active={tab === 'preferences'} onClick={() => setTab('preferences')}>
            {t('profile.preferencesTab')}
          </ProfileTabButton>
        </nav>
        <div className="mt-4">{tab === 'account' ? <AccountTab /> : <PreferencesTab />}</div>
      </div>
    </div>
  );
}

function ProfileTabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`flex min-h-11 items-center rounded-md px-3 text-sm font-medium transition-colors ${
        active ? 'bg-amber-950 text-amber-400' : 'text-stone-300 hover:bg-stone-800'
      }`}
    >
      {children}
    </button>
  );
}

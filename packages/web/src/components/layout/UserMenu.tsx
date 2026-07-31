import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { useLocale } from '../../i18n/LocaleContext';
import { avatarColor, initials } from '../../lib/avatar';
import { Portrait } from '../Portrait';

/*
 * Avatar/top-menu (nav point 7 + settings-consolidation point 6): the single
 * entry point for account-level actions from anywhere in the app. Theme/
 * language/text-size now live only on the My Profile page (ProfilePage,
 * reached via the "My Profile" link below) — they used to be duplicated
 * inline in DashboardPage/CampaignShell/CampaignListPage's own headers, and
 * even after Phase 1 consolidated those into this dropdown, that was still
 * a second place to change the same settings. Built the same
 * click-outside-closes way as Combobox.tsx (no dropdown/menu library in this
 * app either).
 */
export function UserMenu() {
  const { user, logout } = useAuth();
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onClickOutside);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  if (!user) return null;

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={t('nav.userMenuAria', { name: user.displayName })}
        className="flex flex-shrink-0 items-center justify-center rounded-full"
      >
        {user.avatarUrl ? (
          <Portrait fileUrl={user.avatarUrl} alt={user.displayName} size="sm" shape="circle" />
        ) : (
          <span className={`flex size-9 items-center justify-center rounded-full font-display text-sm text-stone-950 ${avatarColor(user.id)}`}>
            {initials(user.displayName)}
          </span>
        )}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-20 mt-2 w-56 space-y-1 rounded-lg border border-stone-800 bg-stone-900 p-3 text-sm shadow-lg"
        >
          <div className="truncate px-1 pb-2 text-stone-300" title={user.displayName}>
            {user.displayName}
          </div>
          <Link
            to="/profile"
            onClick={() => setOpen(false)}
            role="menuitem"
            className="block w-full rounded-md border border-stone-700 px-3 py-2 text-left text-stone-200 hover:bg-stone-800"
          >
            {t('nav.myProfile')}
          </Link>
          <button
            type="button"
            onClick={() => void logout()}
            className="w-full rounded-md border border-stone-700 px-3 py-2 text-left text-stone-200 hover:bg-stone-800"
            role="menuitem"
          >
            {t('common.logOut')}
          </button>
        </div>
      )}
    </div>
  );
}

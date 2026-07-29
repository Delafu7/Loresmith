import { useLocale, SUPPORTED_LOCALES } from '../i18n/LocaleContext';
import type { Locale } from '../lib/types';

const LOCALE_LABELS: Record<Locale, string> = {
  en: 'English',
  es: 'Español',
  fr: 'Français',
};

/**
 * Interface language picker — same shape as ThemePicker, but works both
 * logged in (persists to the user row via /auth/me/locale) and logged out
 * (persists to localStorage only; see LocaleContext.tsx), so it can sit on
 * the login/register screens too, not just the post-auth shell.
 */
export function LocalePicker({ className = '' }: { className?: string }) {
  const { locale, setLocale, localePending, t } = useLocale();

  return (
    <label className={`flex items-center gap-1.5 text-xs text-stone-400 ${className}`}>
      {t('common.language')}
      <select
        value={locale}
        disabled={localePending}
        onChange={(e) => setLocale(e.target.value as Locale)}
        className="min-h-11 rounded-md border border-stone-700 bg-stone-800 px-2 py-1 text-stone-200 disabled:opacity-50"
      >
        {SUPPORTED_LOCALES.map((l) => (
          <option key={l} value={l}>
            {LOCALE_LABELS[l]}
          </option>
        ))}
      </select>
    </label>
  );
}

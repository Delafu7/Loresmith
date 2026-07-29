import { useAuth } from '../auth/AuthContext';
import { useLocale } from '../i18n/LocaleContext';
import type { UiTheme } from '../lib/types';

// "Ember" now renders the Nocturne palette, not the old warm ember-orange
// look (docs/design-tokens.md, OPEN_QUESTIONS.md #10) — the DB enum value
// stays 'ember' (no schema change this pass), but the label a user actually
// picks from is updated so it doesn't lie about what they're selecting.
const THEME_LABELS: Record<UiTheme, string> = {
  ember: 'Nocturne',
  crimson: 'Crimson',
  amber: 'Amber',
};

/**
 * Customizable Styles per Role (Phase 3.9) — every user (DM or player) picks
 * their own theme independently; it's a personal preference on the user
 * row, not a campaign setting. See index.css for the actual palettes and
 * AuthContext.tsx for how the choice gets applied to <html data-theme>.
 */
export function ThemePicker({ className = '' }: { className?: string }) {
  const { user, setTheme, themePending } = useAuth();
  const { t } = useLocale();
  if (!user) return null;

  return (
    <label className={`flex items-center gap-1.5 text-xs text-stone-400 ${className}`}>
      {t('common.theme')}
      <select
        value={user.uiTheme}
        disabled={themePending}
        onChange={(e) => setTheme(e.target.value as UiTheme)}
        className="min-h-11 rounded-md border border-stone-700 bg-stone-800 px-2 py-1 text-stone-200 disabled:opacity-50"
      >
        {(Object.keys(THEME_LABELS) as UiTheme[]).map((theme) => (
          <option key={theme} value={theme}>
            {THEME_LABELS[theme]}
          </option>
        ))}
      </select>
    </label>
  );
}

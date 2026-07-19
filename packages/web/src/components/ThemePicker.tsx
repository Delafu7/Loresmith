import { useAuth } from '../auth/AuthContext';
import type { UiTheme } from '../lib/types';

const THEME_LABELS: Record<UiTheme, string> = {
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
  if (!user) return null;

  return (
    <label className={`flex items-center gap-1.5 text-xs text-stone-400 ${className}`}>
      Theme
      <select
        value={user.uiTheme}
        disabled={themePending}
        onChange={(e) => setTheme(e.target.value as UiTheme)}
        className="rounded-md border border-stone-700 bg-stone-800 px-1.5 py-1 text-stone-200 disabled:opacity-50"
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

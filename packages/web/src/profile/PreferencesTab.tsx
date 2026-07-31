import { useAuth } from '../auth/AuthContext';
import { useLocale } from '../i18n/LocaleContext';
import { Card, CardKicker } from '../components/ui/Card';
import { ThemePicker } from '../components/ThemePicker';
import { LocalePicker } from '../components/LocalePicker';
import type { TextSize } from '../lib/types';

/*
 * Theme/language relocated here from the old inline pickers (DashboardPage,
 * CampaignShell, CampaignListPage, and UserMenu's own dropdown) — one place
 * to change them, per nav point 6 ("remove or redirect the old entry points
 * so there aren't two places to configure the same thing").
 */
export function PreferencesTab() {
  const { t } = useLocale();

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardKicker>{t('profile.appearanceKicker')}</CardKicker>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-6">
          <ThemePicker />
          <LocalePicker />
        </div>
      </Card>
      <Card>
        <CardKicker>{t('profile.accessibilityKicker')}</CardKicker>
        <TextSizePicker />
      </Card>
    </div>
  );
}

function TextSizePicker() {
  const { user, setTextSize, textSizePending } = useAuth();
  const { t } = useLocale();
  if (!user) return null;

  return (
    <label className="flex items-center gap-1.5 text-xs text-stone-400">
      {t('profile.textSizeLabel')}
      <select
        value={user.textSize}
        disabled={textSizePending}
        onChange={(e) => setTextSize(e.target.value as TextSize)}
        className="min-h-11 rounded-md border border-stone-700 bg-stone-800 px-2 py-1 text-stone-200 disabled:opacity-50"
      >
        <option value="normal">{t('profile.textSizeNormal')}</option>
        <option value="large">{t('profile.textSizeLarge')}</option>
      </select>
    </label>
  );
}

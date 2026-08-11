// /about — public (not behind RequireAuth, same reasoning as /styleguide: this
// is reference/legal content, not app data). Surfaces the CC-BY-4.0 attribution
// required for SRD 5.2 content seeded into the catalog (see /ATTRIBUTION.md at
// the repo root) somewhere the running app actually carries it, not just a
// source-only file nobody using the deployed app would ever see.

import { Link } from 'react-router-dom';
import { useLocale } from '../i18n/LocaleContext';

export function AboutPage() {
  const { t } = useLocale();
  return (
    <div className="min-h-dvh bg-stone-950 text-stone-100">
      <header className="border-b border-stone-800 px-4 py-4 pt-[max(1rem,env(safe-area-inset-top))] sm:px-6">
        <Link to="/home" className="text-xs text-stone-500 hover:text-stone-300">
          ← {t('about.backHome')}
        </Link>
      </header>
      <main className="mx-auto max-w-2xl space-y-6 px-4 py-10 sm:px-6">
        <h1 className="font-display text-2xl font-semibold text-stone-100">{t('about.title')}</h1>

        <section className="space-y-2">
          <h2 className="text-sm font-medium uppercase tracking-wide text-stone-400">{t('about.srd2024Title')}</h2>
          <p className="text-sm text-stone-300">
            {t('about.srd2024Body')}
          </p>
          <blockquote className="border-l-2 border-amber-700 pl-3 text-xs italic text-stone-400">
            {t('about.srd2024Attribution')}
          </blockquote>
        </section>

        <section className="space-y-2">
          <h2 className="text-sm font-medium uppercase tracking-wide text-stone-400">{t('about.srd2014Title')}</h2>
          <p className="text-sm text-stone-300">{t('about.srd2014Body')}</p>
        </section>

        <section className="space-y-2">
          <h2 className="text-sm font-medium uppercase tracking-wide text-stone-400">{t('about.limitsTitle')}</h2>
          <p className="text-sm text-stone-300">{t('about.limitsBody')}</p>
        </section>
      </main>
    </div>
  );
}

// Cross-campaign DM notes index (REFACTOR-PLAN.md §1: /notes). Reuses
// GET /me/dashboard's already-aggregated myNotes/campaignNotes rather than a
// new endpoint — DashboardPage already fetches exactly this data for its own
// panels; this route just gives it a dedicated, non-cramped page.

import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { DashboardResponse } from '../lib/types';
import { Loading, ErrorBanner, EmptyState, errorMessage } from '../components/Feedback';
import { useLocale } from '../i18n/LocaleContext';

function relativeTime(iso: string, t: ReturnType<typeof useLocale>['t']): string {
  const diffSec = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (diffSec < 60) return t('notes.indexJustNow');
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return t('notes.indexMinutesAgo', { count: diffMin });
  const diffHour = Math.round(diffMin / 60);
  if (diffHour < 24) return t('notes.indexHoursAgo', { count: diffHour });
  const diffDay = Math.round(diffHour / 24);
  return t('notes.indexDaysAgo', { count: diffDay });
}

export function NotesIndexPage() {
  const { t } = useLocale();
  const dashboardQuery = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api.get<DashboardResponse>('/me/dashboard'),
  });

  return (
    <div className="min-h-dvh bg-stone-950 text-stone-100">
      <header className="border-b border-stone-800 px-4 py-4 pt-[max(1rem,env(safe-area-inset-top))] flex items-center gap-4 sm:px-6">
        <Link to="/home" className="text-xs text-stone-500 hover:text-stone-300">
          {t('notes.indexBackHome')}
        </Link>
        <h1 className="font-display text-xl font-medium">{t('notes.title')}</h1>
      </header>
      <main className="max-w-3xl mx-auto px-4 py-6 space-y-8 sm:py-8">
        {dashboardQuery.isLoading && <Loading />}
        {dashboardQuery.isError && <ErrorBanner message={errorMessage(dashboardQuery.error)} />}

        {dashboardQuery.data && (
          <>
            <NoteSection title={t('notes.indexYourNotes')} notes={dashboardQuery.data.myNotes} />
            <NoteSection title={t('notes.indexCampaignNotes')} notes={dashboardQuery.data.campaignNotes} />
          </>
        )}
      </main>
    </div>
  );
}

function NoteSection({ title, notes }: { title: string; notes: DashboardResponse['myNotes'] }) {
  const { t } = useLocale();
  return (
    <section>
      <h2 className="text-sm uppercase tracking-wide text-stone-500 mb-2">{title}</h2>
      {notes.length === 0 && <EmptyState message={t('notes.indexEmpty')} />}
      <ul className="space-y-2">
        {notes.map((n) => (
          <li key={n.id}>
            <Link
              to={`/campaigns/${n.campaign_id}/notes`}
              className="block rounded-md bg-stone-900 shadow-sm hover:bg-stone-800/70 transition-colors px-4 py-3"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-stone-100 truncate">{n.title}</span>
                <span className="text-xs text-stone-500 flex-shrink-0">{relativeTime(n.created_at, t)}</span>
              </div>
              <span className="text-xs text-stone-500">{n.campaign_name}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

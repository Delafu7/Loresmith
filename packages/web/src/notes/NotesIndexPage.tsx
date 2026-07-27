// Cross-campaign DM notes index (REFACTOR-PLAN.md §1: /notes). Reuses
// GET /me/dashboard's already-aggregated myNotes/campaignNotes rather than a
// new endpoint — DashboardPage already fetches exactly this data for its own
// panels; this route just gives it a dedicated, non-cramped page.

import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { DashboardResponse } from '../lib/types';
import { Loading, ErrorBanner, EmptyState, errorMessage } from '../components/Feedback';

function relativeTime(iso: string): string {
  const diffSec = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (diffSec < 60) return 'just now';
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHour = Math.round(diffMin / 60);
  if (diffHour < 24) return `${diffHour}h ago`;
  const diffDay = Math.round(diffHour / 24);
  return `${diffDay}d ago`;
}

export function NotesIndexPage() {
  const dashboardQuery = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api.get<DashboardResponse>('/me/dashboard'),
  });

  return (
    <div className="min-h-dvh bg-stone-950 text-stone-100">
      <header className="border-b border-stone-800 px-6 py-4 flex items-center gap-4">
        <Link to="/home" className="text-xs text-stone-500 hover:text-stone-300">
          ← Home
        </Link>
        <h1 className="text-xl font-semibold">Notes</h1>
      </header>
      <main className="max-w-3xl mx-auto px-4 py-8 space-y-8">
        {dashboardQuery.isLoading && <Loading />}
        {dashboardQuery.isError && <ErrorBanner message={errorMessage(dashboardQuery.error)} />}

        {dashboardQuery.data && (
          <>
            <NoteSection title="Your notes" notes={dashboardQuery.data.myNotes} />
            <NoteSection title="Campaign notes" notes={dashboardQuery.data.campaignNotes} />
          </>
        )}
      </main>
    </div>
  );
}

function NoteSection({ title, notes }: { title: string; notes: DashboardResponse['myNotes'] }) {
  return (
    <section>
      <h2 className="text-sm uppercase tracking-wide text-stone-500 mb-2">{title}</h2>
      {notes.length === 0 && <EmptyState message="Nothing here yet." />}
      <ul className="space-y-2">
        {notes.map((n) => (
          <li key={n.id}>
            <Link
              to={`/campaigns/${n.campaign_id}/notes`}
              className="block rounded-md border border-stone-800 bg-stone-900 hover:border-amber-700 hover:bg-stone-800/60 transition-colors px-4 py-3"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-stone-100 truncate">{n.title}</span>
                <span className="text-xs text-stone-500 flex-shrink-0">{relativeTime(n.created_at)}</span>
              </div>
              <span className="text-xs text-stone-500">{n.campaign_name}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { DashboardResponse } from '../lib/types';
import { useAuth } from '../auth/AuthContext';
import { Loading, ErrorBanner, EmptyState, errorMessage } from '../components/Feedback';
import { ThemePicker } from '../components/ThemePicker';

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

/**
 * Landing page after login (Phase 3.6) — aggregates GET /me/dashboard into
 * four panels: the user's characters, the campaigns those characters (and
 * any DM'd campaigns) belong to, notes the user wrote themselves, and recent
 * notes from across those campaigns. Previously there was no home view at
 * all — root `/` went straight to the campaign list.
 */
export function DashboardPage() {
  const { user, logout } = useAuth();

  const dashboardQuery = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api.get<DashboardResponse>('/me/dashboard'),
  });

  return (
    <div className="min-h-screen bg-stone-950 text-stone-100">
      <header className="border-b border-stone-800 px-6 py-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Dashboard</h1>
        <div className="flex items-center gap-4 text-sm text-stone-400">
          <Link to="/campaigns" className="hover:text-stone-200">
            All campaigns
          </Link>
          <ThemePicker />
          <span>{user?.displayName}</span>
          <button
            type="button"
            onClick={() => void logout()}
            className="rounded-md border border-stone-700 px-3 py-1.5 hover:bg-stone-800"
          >
            Log out
          </button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8 space-y-6">
        {dashboardQuery.isLoading && <Loading />}
        {dashboardQuery.isError && <ErrorBanner message={errorMessage(dashboardQuery.error)} />}

        {dashboardQuery.data && (
          <div className="grid sm:grid-cols-2 gap-4">
            <section className="rounded-lg border border-stone-800 bg-stone-900 p-4 sm:p-5 space-y-3">
              <h3 className="text-xs uppercase text-stone-500">Your characters</h3>
              {dashboardQuery.data.characters.length === 0 && (
                <EmptyState message="You don't own any characters yet." />
              )}
              <ul className="space-y-2">
                {dashboardQuery.data.characters.map((c) => (
                  <li key={c.id}>
                    <Link
                      to={`/campaigns/${c.campaign_id}/characters/${c.id}`}
                      className="block rounded-md border border-stone-800 hover:border-amber-700 hover:bg-stone-800/60 transition-colors px-3 py-2"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-stone-100 truncate">{c.name}</span>
                        {!c.is_pc && (
                          <span className="text-[10px] uppercase text-stone-500 border border-stone-700 rounded px-1 flex-shrink-0">
                            NPC
                          </span>
                        )}
                      </div>
                      <span className="text-xs text-stone-500">{c.campaign_name}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>

            <section className="rounded-lg border border-stone-800 bg-stone-900 p-4 sm:p-5 space-y-3">
              <h3 className="text-xs uppercase text-stone-500">Your campaigns</h3>
              {dashboardQuery.data.campaigns.length === 0 && (
                <EmptyState message="You're not in any campaigns yet." />
              )}
              <ul className="space-y-2">
                {dashboardQuery.data.campaigns.map((c) => (
                  <li key={c.id}>
                    <Link
                      to={`/campaigns/${c.id}/characters`}
                      className="block rounded-md border border-stone-800 hover:border-amber-700 hover:bg-stone-800/60 transition-colors px-3 py-2"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-stone-100 truncate">{c.name}</span>
                        <span className="text-[10px] uppercase tracking-wide text-stone-500 flex-shrink-0">
                          {c.my_role}
                        </span>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>

            <section className="rounded-lg border border-stone-800 bg-stone-900 p-4 sm:p-5 space-y-3">
              <h3 className="text-xs uppercase text-stone-500">Your notes</h3>
              {dashboardQuery.data.myNotes.length === 0 && <EmptyState message="You haven't written any notes yet." />}
              <ul className="space-y-2">
                {dashboardQuery.data.myNotes.map((n) => (
                  <li key={n.id}>
                    <Link
                      to={`/campaigns/${n.campaign_id}/notes`}
                      className="block rounded-md border border-stone-800 hover:border-amber-700 hover:bg-stone-800/60 transition-colors px-3 py-2"
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

            <section className="rounded-lg border border-stone-800 bg-stone-900 p-4 sm:p-5 space-y-3">
              <h3 className="text-xs uppercase text-stone-500">Campaign notes</h3>
              {dashboardQuery.data.campaignNotes.length === 0 && (
                <EmptyState message="No notes in your campaigns yet." />
              )}
              <ul className="space-y-2">
                {dashboardQuery.data.campaignNotes.map((n) => (
                  <li key={n.id}>
                    <Link
                      to={`/campaigns/${n.campaign_id}/notes`}
                      className="block rounded-md border border-stone-800 hover:border-amber-700 hover:bg-stone-800/60 transition-colors px-3 py-2"
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
          </div>
        )}
      </main>
    </div>
  );
}

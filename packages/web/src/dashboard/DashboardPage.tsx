import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { DashboardResponse } from '../lib/types';
import { useAuth } from '../auth/AuthContext';
import { Loading, ErrorBanner, EmptyState, errorMessage } from '../components/Feedback';
import { ThemePicker } from '../components/ThemePicker';
import { Card, CardKicker } from '../components/ui/Card';
import { Button } from '../components/ui/Button';

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
 * Post-auth hub (Phase 3.6; moved to /home in REFACTOR-PLAN.md §8 — `/` is
 * now the public landing/intro transition, not this page) — aggregates
 * GET /me/dashboard into four panels: the user's characters, the campaigns
 * those characters (and any DM'd campaigns) belong to, notes the user wrote
 * themselves, and recent notes from across those campaigns.
 */
export function DashboardPage() {
  const { user, logout } = useAuth();

  const dashboardQuery = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api.get<DashboardResponse>('/me/dashboard'),
  });

  return (
    <div className="min-h-dvh bg-stone-950 text-stone-100">
      <header className="border-b border-stone-800 px-4 py-4 pt-[max(1rem,env(safe-area-inset-top))] sm:px-6">
        <div className="flex items-center justify-between gap-3">
          <h1 className="font-display text-xl font-medium">Home</h1>
          <div className="flex items-center gap-3">
            <ThemePicker className="max-sm:hidden" />
            <span className="hidden text-sm text-stone-400 sm:inline">{user?.displayName}</span>
            <Button variant="secondary" size="sm" onClick={() => void logout()}>
              Log out
            </Button>
          </div>
        </div>
        <nav className="mt-3 flex flex-wrap gap-1 text-sm" aria-label="Sections">
          <HubNavLink to="/campaigns">All campaigns</HubNavLink>
          <HubNavLink to="/bestiary">Bestiary</HubNavLink>
          <HubNavLink to="/maps">Maps</HubNavLink>
          <HubNavLink to="/notes">Notes</HubNavLink>
        </nav>
      </header>

      <main className="mx-auto max-w-5xl space-y-6 px-4 py-6 sm:py-8">
        {dashboardQuery.isLoading && <Loading />}
        {dashboardQuery.isError && <ErrorBanner message={errorMessage(dashboardQuery.error)} />}

        {dashboardQuery.data && (
          <div className="grid gap-4 sm:grid-cols-2">
            <HubSection kicker="Your characters">
              {dashboardQuery.data.characters.length === 0 && (
                <EmptyState message="You don't own any characters yet." />
              )}
              <ul className="space-y-2">
                {dashboardQuery.data.characters.map((c) => (
                  <li key={c.id}>
                    <HubRow to={`/campaigns/${c.campaign_id}/characters/${c.id}`}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate font-medium text-stone-100">{c.name}</span>
                        {!c.is_pc && (
                          <span className="flex-shrink-0 rounded border border-stone-700 px-1 text-[10px] uppercase text-stone-500">
                            NPC
                          </span>
                        )}
                      </div>
                      <span className="text-xs text-stone-500">{c.campaign_name}</span>
                    </HubRow>
                  </li>
                ))}
              </ul>
            </HubSection>

            <HubSection kicker="Your campaigns">
              {dashboardQuery.data.campaigns.length === 0 && (
                <EmptyState message="You're not in any campaigns yet." />
              )}
              <ul className="space-y-2">
                {dashboardQuery.data.campaigns.map((c) => (
                  <li key={c.id}>
                    <HubRow to={`/campaigns/${c.id}/characters`}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate font-medium text-stone-100">{c.name}</span>
                        <span className="flex-shrink-0 text-[10px] uppercase tracking-wide text-stone-500">
                          {c.my_role}
                        </span>
                      </div>
                    </HubRow>
                  </li>
                ))}
              </ul>
            </HubSection>

            <HubSection kicker="Your notes">
              {dashboardQuery.data.myNotes.length === 0 && <EmptyState message="You haven't written any notes yet." />}
              <ul className="space-y-2">
                {dashboardQuery.data.myNotes.map((n) => (
                  <li key={n.id}>
                    <HubRow to={`/campaigns/${n.campaign_id}/notes`}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate font-medium text-stone-100">{n.title}</span>
                        <span className="flex-shrink-0 text-xs text-stone-500">{relativeTime(n.created_at)}</span>
                      </div>
                      <span className="text-xs text-stone-500">{n.campaign_name}</span>
                    </HubRow>
                  </li>
                ))}
              </ul>
            </HubSection>

            <HubSection kicker="Campaign notes">
              {dashboardQuery.data.campaignNotes.length === 0 && (
                <EmptyState message="No notes in your campaigns yet." />
              )}
              <ul className="space-y-2">
                {dashboardQuery.data.campaignNotes.map((n) => (
                  <li key={n.id}>
                    <HubRow to={`/campaigns/${n.campaign_id}/notes`}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate font-medium text-stone-100">{n.title}</span>
                        <span className="flex-shrink-0 text-xs text-stone-500">{relativeTime(n.created_at)}</span>
                      </div>
                      <span className="text-xs text-stone-500">{n.campaign_name}</span>
                    </HubRow>
                  </li>
                ))}
              </ul>
            </HubSection>
          </div>
        )}
      </main>
    </div>
  );
}

function HubNavLink({ to, children }: { to: string; children: string }) {
  return (
    <Link
      to={to}
      className="flex min-h-11 items-center rounded-md px-3 text-stone-400 transition-colors hover:bg-stone-800 hover:text-stone-100"
    >
      {children}
    </Link>
  );
}

function HubSection({ kicker, children }: { kicker: string; children: ReactNode }) {
  return (
    <Card>
      <CardKicker>{kicker}</CardKicker>
      {children}
    </Card>
  );
}

function HubRow({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link
      to={to}
      className="block rounded-md px-3 py-2.5 transition-colors hover:bg-stone-800/70"
    >
      {children}
    </Link>
  );
}

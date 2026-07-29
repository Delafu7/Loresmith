import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { DashboardCharacter, DashboardResponse } from '../lib/types';
import { useAuth } from '../auth/AuthContext';
import { Loading, ErrorBanner, EmptyState, errorMessage } from '../components/Feedback';
import { ThemePicker } from '../components/ThemePicker';
import { Card, CardKicker } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button, ButtonLink } from '../components/ui/Button';
import { HPBar } from '../components/HPBar';

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

// Deterministic per-character avatar tint — same character always gets the
// same color across a session/reload, cycling through the app's existing
// amber/stone theme slots (design-tokens.md: "amber-500/600/700 = avatar
// fill variety") rather than inventing new hardcoded hex colors, so this
// still repaints correctly under every theme (ember/crimson/amber) and dark
// mode alike.
export const AVATAR_COLORS = ['bg-amber-600', 'bg-amber-500', 'bg-amber-700', 'bg-stone-600', 'bg-stone-500'];
export function avatarColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length]!;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? parts[parts.length - 1]![0] : '';
  return (first + last).toUpperCase();
}

/**
 * Post-auth hub (Phase 3.6; moved to /home in REFACTOR-PLAN.md §8 — `/` is
 * now the public landing/intro transition, not this page) — aggregates
 * GET /me/dashboard into: a "your characters" roster styled after the
 * Nocturne mockup's own dashboard party row (design/nocturne.html's
 * `isDashboard` screen — the one part of that source mockup built for
 * exactly this "party at a glance" idea, adapted here for a CROSS-campaign
 * hub rather than the source's single-campaign context: no in-world
 * date/session kicker to show, so the kicker line summarizes the user's own
 * roster/campaign counts instead), plus three list cards (campaigns, notes
 * you wrote, recent notes across your campaigns) matching the mockup's
 * "World calendar" card pattern (divided rows + a ghost "see all" link).
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
        <div className="flex flex-wrap items-center justify-end gap-3">
          <ThemePicker />
          <span className="hidden text-sm text-stone-400 sm:inline">{user?.displayName}</span>
          <Button variant="secondary" size="sm" onClick={() => void logout()}>
            Log out
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-8 px-4 py-6 sm:py-8">
        {dashboardQuery.isLoading && <Loading />}
        {dashboardQuery.isError && <ErrorBanner message={errorMessage(dashboardQuery.error)} />}

        {dashboardQuery.data && (
          <>
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <CardKicker className="mb-1.5">
                  {dashboardQuery.data.characters.length} character{dashboardQuery.data.characters.length === 1 ? '' : 's'} ·{' '}
                  {dashboardQuery.data.campaigns.length} campaign{dashboardQuery.data.campaigns.length === 1 ? '' : 's'}
                </CardKicker>
                <h1 className="font-display text-[28px] font-medium leading-tight sm:text-[30px]">
                  Welcome back, {user?.displayName}
                </h1>
              </div>
              <nav className="flex flex-wrap gap-1 text-sm" aria-label="Sections">
                <HubNavLink to="/campaigns">All campaigns</HubNavLink>
                <HubNavLink to="/bestiary">Bestiary</HubNavLink>
                <HubNavLink to="/maps">Maps</HubNavLink>
                <HubNavLink to="/notes">Notes</HubNavLink>
              </nav>
            </div>

            <section>
              <h2 className="mb-3 text-xs font-medium uppercase tracking-wider text-stone-500">Your characters</h2>
              {dashboardQuery.data.characters.length === 0 ? (
                <EmptyState message="You don't own any characters yet." />
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {dashboardQuery.data.characters.map((c) => (
                    <CharacterCard key={c.id} character={c} />
                  ))}
                </div>
              )}
            </section>

            <div className="grid gap-4 lg:grid-cols-3">
              <ListCard kicker="Your campaigns" to="/campaigns" linkLabel="All campaigns →" empty="You're not in any campaigns yet." count={dashboardQuery.data.campaigns.length}>
                {dashboardQuery.data.campaigns.map((c) => (
                  <ListRow key={c.id} to={`/campaigns/${c.id}/characters`} title={c.name} trailing={<Badge variant="outline">{c.my_role}</Badge>} />
                ))}
              </ListCard>

              <ListCard kicker="Your notes" to="/notes" linkLabel="All notes →" empty="You haven't written any notes yet." count={dashboardQuery.data.myNotes.length}>
                {dashboardQuery.data.myNotes.slice(0, 6).map((n) => (
                  <ListRow
                    key={n.id}
                    to={`/campaigns/${n.campaign_id}/notes`}
                    title={n.title}
                    meta={n.campaign_name}
                    trailing={<span className="flex-shrink-0 text-[11px] text-stone-500">{relativeTime(n.created_at)}</span>}
                  />
                ))}
              </ListCard>

              <ListCard kicker="Campaign activity" to="/notes" linkLabel="All notes →" empty="No notes in your campaigns yet." count={dashboardQuery.data.campaignNotes.length}>
                {dashboardQuery.data.campaignNotes.slice(0, 6).map((n) => (
                  <ListRow
                    key={n.id}
                    to={`/campaigns/${n.campaign_id}/notes`}
                    title={n.title}
                    meta={n.campaign_name}
                    trailing={<span className="flex-shrink-0 text-[11px] text-stone-500">{relativeTime(n.created_at)}</span>}
                  />
                ))}
              </ListCard>
            </div>
          </>
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

function CharacterCard({ character }: { character: DashboardCharacter }) {
  return (
    <Card elevation="sm">
      {/* Negative margin + own padding, rather than fighting Card's own p-4
          via a later className override (Tailwind class ORDER in the
          attribute string doesn't reliably decide the cascade) — the Link
          fills the card and carries its own hover state. */}
      <Link
        to={`/campaigns/${character.campaign_id}/characters/${character.id}`}
        className="-m-4 flex flex-col gap-2.5 rounded-md p-4 transition-colors hover:bg-stone-800/70"
      >
        <div className="flex items-center gap-2.5">
          <div
            className={`flex size-9 flex-shrink-0 items-center justify-center rounded-full font-display text-sm text-stone-950 ${avatarColor(character.id)}`}
          >
            {initials(character.name)}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="truncate text-sm font-medium text-stone-100">{character.name}</span>
              {!character.is_pc && <Badge variant="neutral">NPC</Badge>}
            </div>
            <span className="block truncate text-[11px] text-stone-500">{character.campaign_name}</span>
          </div>
        </div>
        <HPBar current={character.hp_current} max={character.hp_max} temp={character.hp_temp} />
        <div className="text-right text-[11px] text-stone-500">AC {character.armor_class}</div>
      </Link>
    </Card>
  );
}

function ListCard({
  kicker,
  to,
  linkLabel,
  empty,
  count,
  children,
}: {
  kicker: string;
  to: string;
  linkLabel: string;
  empty: string;
  count: number;
  children: ReactNode;
}) {
  return (
    <Card className="flex flex-col">
      <CardKicker>{kicker}</CardKicker>
      {count === 0 ? <EmptyState message={empty} /> : <ul className="mt-1 divide-y divide-stone-800">{children}</ul>}
      <div className="mt-2 pt-1">
        <ButtonLink to={to} variant="ghost" size="sm">
          {linkLabel}
        </ButtonLink>
      </div>
    </Card>
  );
}

function ListRow({ to, title, meta, trailing }: { to: string; title: string; meta?: string; trailing?: ReactNode }) {
  return (
    <li>
      <Link to={to} className="flex items-center justify-between gap-2 py-2.5 transition-colors hover:text-amber-400">
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium text-stone-100">{title}</span>
          {meta && <span className="block truncate text-[11px] text-stone-500">{meta}</span>}
        </span>
        {trailing}
      </Link>
    </li>
  );
}

// Campaign-scoped Dashboard (design/nocturne.html's `isDashboard` screen,
// adapted to this campaign's own data instead of the mockup's static sample
// content) — the new default landing view for a campaign (see App.tsx's
// index redirect). Composed entirely from queries other pages in this
// campaign already fetch (same query keys, so the cache is shared, not
// duplicated) — no new server endpoints. useLiveMapAutoOpen (mounted at
// CampaignShell, unaffected by which child route this is) already redirects
// straight to the fullscreen map the instant an encounter goes active, so
// this page only ever needs to handle the "nothing live right now" state.
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { Character, Encounter, SessionLog } from '../lib/types';
import { useCampaignShell } from './CampaignShell';
import { useLocale } from '../i18n/LocaleContext';
import { Loading, ErrorBanner, EmptyState, errorMessage } from '../components/Feedback';
import { Card, CardKicker } from '../components/ui/Card';
import { ButtonLink } from '../components/ui/Button';
import { HPBar } from '../components/HPBar';
import { avatarColor, initials } from '../lib/avatar';

export function CampaignDashboardPage() {
  const { campaignId, campaign, role } = useCampaignShell();
  const { t } = useLocale();
  const isDm = role === 'dm';

  const charactersQuery = useQuery({
    queryKey: ['characters', campaignId],
    queryFn: () => api.get<{ characters: Character[] }>(`/campaigns/${campaignId}/characters`),
  });
  const encountersQuery = useQuery({
    queryKey: ['encounters', campaignId],
    queryFn: () => api.get<{ encounters: Encounter[] }>(`/campaigns/${campaignId}/encounters`),
  });
  const sessionsQuery = useQuery({
    queryKey: ['session-log', campaignId],
    queryFn: () => api.get<{ sessions: SessionLog[] }>(`/campaigns/${campaignId}/sessions`),
  });

  const nextEncounter = encountersQuery.data?.encounters
    .filter((e) => e.status === 'preparing')
    .sort((a, b) => a.created_at.localeCompare(b.created_at))[0];

  // Server already orders by session_number ASC (see SessionLogPage.tsx) —
  // the latest chronicle is the last entry, not the first.
  const latestSession = sessionsQuery.data?.sessions.at(-1);

  return (
    <div className="px-4 sm:px-6 py-6 max-w-6xl mx-auto space-y-6">
      <h1 className="font-display text-2xl font-medium">{t('campaignDashboard.welcome', { name: campaign.name })}</h1>

      <section>
        <h2 className="mb-3 text-xs font-medium uppercase tracking-wider text-stone-500">{t('campaignDashboard.party')}</h2>
        {charactersQuery.isLoading && <Loading />}
        {charactersQuery.isError && <ErrorBanner message={errorMessage(charactersQuery.error)} />}
        {charactersQuery.data && charactersQuery.data.characters.length === 0 && (
          <EmptyState message={t('campaignDashboard.noCharacters')} />
        )}
        {charactersQuery.data && charactersQuery.data.characters.length > 0 && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {charactersQuery.data.characters.map((c) => (
              <CampaignCharacterCard key={c.id} campaignId={campaignId} character={c} />
            ))}
          </div>
        )}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="flex flex-col">
          <CardKicker>{t('campaignDashboard.nextSessionKicker')}</CardKicker>
          {encountersQuery.isLoading && <Loading />}
          {nextEncounter ? (
            <>
              <p className="font-display text-base font-medium">{nextEncounter.name}</p>
              <p className="text-xs text-stone-500">{t('campaignDashboard.nextSessionHint')}</p>
            </>
          ) : (
            <EmptyState message={isDm ? t('campaignDashboard.noUpcomingDm') : t('campaignDashboard.noUpcomingPlayer')} />
          )}
          <div className="mt-2 pt-1">
            <ButtonLink to={`/campaigns/${campaignId}/session`} variant="ghost" size="sm">
              {isDm && !nextEncounter ? t('campaignDashboard.createEncounterLink') : t('campaignDashboard.openSessionLink')}
            </ButtonLink>
          </div>
        </Card>

        <Card className="flex flex-col">
          <CardKicker>{t('campaignDashboard.latestChronicleKicker')}</CardKicker>
          {sessionsQuery.isLoading && <Loading />}
          {latestSession ? (
            <>
              <p className="font-display text-base font-medium">
                {t('sessionLog.session', { number: latestSession.session_number })}
                {latestSession.title ? ` — ${latestSession.title}` : ''}
              </p>
              {latestSession.recap && <p className="text-xs text-stone-400 line-clamp-3">{latestSession.recap}</p>}
            </>
          ) : (
            <EmptyState message={t('campaignDashboard.noChronicle')} />
          )}
          <div className="mt-2 pt-1">
            <ButtonLink to={`/campaigns/${campaignId}/session-log`} variant="ghost" size="sm">
              {t('campaignDashboard.openSessionLogLink')}
            </ButtonLink>
          </div>
        </Card>
      </div>
    </div>
  );
}

function CampaignCharacterCard({ campaignId, character }: { campaignId: string; character: Character }) {
  const { t } = useLocale();
  return (
    <Card elevation="sm">
      <Link
        to={`/campaigns/${campaignId}/characters/${character.id}`}
        className="-m-4 flex flex-col gap-2.5 rounded-md p-4 transition-colors hover:bg-stone-800/70"
      >
        <div className="flex items-center gap-2.5">
          <div
            className={`flex size-9 flex-shrink-0 items-center justify-center rounded-full font-display text-sm text-stone-950 ${avatarColor(character.id)}`}
          >
            {initials(character.name)}
          </div>
          <div className="min-w-0">
            <span className="block truncate text-sm font-medium text-stone-100">{character.name}</span>
            <span className="block truncate text-[11px] text-stone-500">{t('campaignDashboard.acLine', { ac: character.armor_class })}</span>
          </div>
        </div>
        <HPBar current={character.hp_current} max={character.hp_max} temp={character.hp_temp} />
      </Link>
    </Card>
  );
}

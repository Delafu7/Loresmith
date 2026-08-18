// Docked (non-covering) description panel for the live map — content-catalog
// refactor: "the description of the currently selected entity is readable
// and editable from the map view, in a panel docked below the map, not a
// modal." Sits below BattleMap+sidebar in SessionScreen.tsx, as a sibling in
// that flex-col layout, so it never overlaps the map canvas the way
// ParticipantSheetPanel's overlay drawer does.
//
// "Currently selected entity" resolves per the selected token's type: a
// creature token -> that monster's own catalog description, fetched by id
// via GET /catalog/monsters/:id (NOT SessionScreen's `monsters` prop, which
// is sourced from the campaign's CURATED bestiary and can be empty even for
// an actively spawned monster instance — confirmed live: an in-progress
// encounter can have monster_instances with no matching
// campaign_bestiary_entries row at all, despite services/campaignBestiary.ts's
// assertMonsterCuratedInBestiary comment suggesting otherwise); a PC token ->
// that character's RACE description (the one catalog "template" a player
// character maps to 1:1), via campaign_race_entries if the DM has already
// imported that race into this campaign, else the base races catalog row.
//
// Editing writes through the EXISTING campaign-entry override endpoints
// (PATCH .../bestiary/:id { statOverrides }, PATCH .../races/:id
// { overrides }) — same fork-free "shallow-merge JSONB blob over the base
// catalog row" mechanism those entries already use for armorClass/hp/etc.
// overrides, just with a `description` key. No new backend surface. A
// creature or PC race with no existing campaign entry gets one created on
// first edit (idempotent POST, same "Add from catalog" action
// AddToBestiaryPage.tsx/CampaignRacesClassesPage.tsx already expose), then
// the override PATCH lands on that fresh entry.
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type {
  CampaignBestiaryEntry,
  CampaignRaceEntry,
  Character,
  MonsterCatalogEntry,
  MonsterInstance,
  SnapshotParticipant,
} from '../lib/types';
import { useCampaignShell } from '../campaigns/CampaignShell';
import { useRacesCatalog } from '../lib/useCatalog';
import { useLocale } from '../i18n/LocaleContext';
import { Button } from '../components/ui/Button';
import { Textarea } from '../components/ui/Field';
import { Loading, ErrorBanner, errorMessage } from '../components/Feedback';

interface ResolvedEntity {
  kind: 'monster' | 'race';
  heading: string;
  subheading: string | null;
  description: string;
  loading: boolean;
  // Present only when there's something for the DM to save a description
  // change to (i.e. the underlying data has loaded).
  save: ((description: string) => Promise<unknown>) | null;
}

function useResolvedEntity(
  participant: SnapshotParticipant,
  characters: Character[] | undefined,
  monsterInstances: MonsterInstance[] | undefined,
  monsters: MonsterCatalogEntry[] | undefined,
): ResolvedEntity | null {
  const { campaignId, campaign } = useCampaignShell();
  const queryClient = useQueryClient();
  const { t } = useLocale();

  const character = participant.characterId ? (characters?.find((c) => c.id === participant.characterId) ?? null) : null;
  const monsterInstance = participant.monsterInstanceId
    ? (monsterInstances?.find((mi) => mi.id === participant.monsterInstanceId) ?? null)
    : null;
  const monsterFromProp = monsterInstance ? (monsters?.find((m) => m.id === monsterInstance.monster_id) ?? null) : null;

  // SessionScreen's `monsters` prop is sourced from the campaign's CURATED
  // bestiary (useEncounterSessionData's bestiaryQuery), not the global
  // catalog — a monster instance can exist (and be on the map) without ever
  // having been added to campaign_bestiary_entries, so that prop can be
  // empty even for a real, spawned creature. Fetch the catalog row directly
  // by id (same GET /catalog/monsters/:id single-entity route
  // BestiaryEntryDetail.tsx already uses for `derived_from_template_id`) as
  // the source of truth, independent of bestiary curation state.
  const monsterCatalogQuery = useQuery({
    queryKey: ['catalog', 'monsters', monsterInstance?.monster_id],
    queryFn: () => api.get<{ monster: MonsterCatalogEntry }>(`/catalog/monsters/${monsterInstance!.monster_id}`),
    enabled: monsterInstance !== null,
  });
  const monster = monsterFromProp ?? monsterCatalogQuery.data?.monster ?? null;

  // Deliberately NOT ['campaignBestiary', campaignId] — that exact key is
  // already used by useEncounterSessionData.ts's own bestiaryQuery, whose
  // queryFn returns a DIFFERENTLY-shaped value ({ monsters: [...] } instead
  // of { entries: [...] }). TanStack Query caches by key only; two queries
  // sharing a key but returning different shapes means whichever fetch
  // settles last wins the cache for BOTH observers (see LiveMapPage.tsx's
  // own header comment on this exact hazard) — confirmed live: this
  // collision crashed the panel with "Cannot read properties of undefined
  // (reading 'find')" once useEncounterSessionData's differently-shaped
  // fetch won the race.
  const bestiaryQueryKey = ['campaignBestiaryEntries', campaignId];
  const bestiaryQuery = useQuery({
    queryKey: bestiaryQueryKey,
    queryFn: () => api.get<{ entries: CampaignBestiaryEntry[] }>(`/campaigns/${campaignId}/bestiary`),
    enabled: monsterInstance !== null,
  });

  const raceEntriesQueryKey = ['campaignRacesClasses', 'races', campaignId];
  const raceEntriesQuery = useQuery({
    queryKey: raceEntriesQueryKey,
    queryFn: () => api.get<{ entries: CampaignRaceEntry[] }>(`/campaigns/${campaignId}/races`),
    enabled: character !== null && character.race_id !== null,
  });
  const racesCatalogQuery = useRacesCatalog(campaign.srd_edition);

  if (monsterInstance !== null) {
    if (monster === null || bestiaryQuery.isLoading) {
      return { kind: 'monster', heading: monsterInstance.custom_name ?? '', subheading: null, description: '', loading: true, save: null };
    }
    const entry = bestiaryQuery.data?.entries.find((e) => e.monster_id === monster.id) ?? null;
    const heading = entry?.custom_name || monsterInstance.custom_name || monster.name;
    const description = entry ? (entry.effective.description ?? '') : (monster.description ?? '');
    return {
      kind: 'monster',
      heading,
      subheading: t('encounters.descriptionPanel.creatureSubheading'),
      description,
      loading: false,
      save: async (text: string) => {
        let entryId = entry?.id ?? null;
        if (entryId === null) {
          await api.post(`/campaigns/${campaignId}/bestiary`, { monsterIds: [monster.id] });
          const fresh = await queryClient.fetchQuery({
            queryKey: bestiaryQueryKey,
            queryFn: () => api.get<{ entries: CampaignBestiaryEntry[] }>(`/campaigns/${campaignId}/bestiary`),
          });
          entryId = fresh.entries.find((e) => e.monster_id === monster.id)?.id ?? null;
        }
        if (entryId === null) throw new Error('Could not link this creature into the campaign bestiary');
        await api.patch(`/campaigns/${campaignId}/bestiary/${entryId}`, { statOverrides: { description: text } });
        await queryClient.invalidateQueries({ queryKey: bestiaryQueryKey });
        // Also invalidate useEncounterSessionData's differently-shaped
        // ['campaignBestiary', campaignId] cache — a newly-linked entry
        // should show up wherever that query feeds the spawn/roster UI too.
        await queryClient.invalidateQueries({ queryKey: ['campaignBestiary', campaignId] });
      },
    };
  }

  if (character !== null && character.race_id !== null) {
    if (raceEntriesQuery.isLoading || racesCatalogQuery.isLoading) {
      return { kind: 'race', heading: character.name, subheading: null, description: '', loading: true, save: null };
    }
    const raceId = character.race_id;
    const entry = raceEntriesQuery.data?.entries.find((e) => e.race_id === raceId) ?? null;
    const baseRace = racesCatalogQuery.data?.races.find((r) => r.id === raceId) ?? null;
    const raceName = entry?.race.name ?? baseRace?.name ?? '';
    const description = entry ? (entry.effective.description ?? '') : (baseRace?.description ?? '');
    return {
      kind: 'race',
      heading: character.name,
      subheading: t('encounters.descriptionPanel.raceSubheading', { race: raceName }),
      description,
      loading: false,
      save: async (text: string) => {
        let entryId = entry?.id ?? null;
        if (entryId === null) {
          await api.post(`/campaigns/${campaignId}/races`, { raceIds: [raceId] });
          const fresh = await queryClient.fetchQuery({
            queryKey: raceEntriesQueryKey,
            queryFn: () => api.get<{ entries: CampaignRaceEntry[] }>(`/campaigns/${campaignId}/races`),
          });
          entryId = fresh.entries.find((e) => e.race_id === raceId)?.id ?? null;
        }
        if (entryId === null) throw new Error('Could not link this race into the campaign catalog');
        await api.patch(`/campaigns/${campaignId}/races/${entryId}`, { overrides: { description: text } });
        await queryClient.invalidateQueries({ queryKey: raceEntriesQueryKey });
      },
    };
  }

  return null;
}

export function MapDescriptionPanel({
  participant,
  isDm,
  characters,
  monsterInstances,
  monsters,
}: {
  participant: SnapshotParticipant | null;
  isDm: boolean;
  characters: Character[] | undefined;
  monsterInstances: MonsterInstance[] | undefined;
  monsters: MonsterCatalogEntry[] | undefined;
}) {
  return participant ? (
    // Keyed on participantId so collapsed/editing/draft state resets when
    // the DM selects a different token — without this, collapsing (or
    // mid-edit-draft) while viewing one creature silently carried over to
    // the next unrelated one selected afterward (confirmed live).
    <MapDescriptionPanelInner
      key={participant.participantId}
      participant={participant}
      isDm={isDm}
      characters={characters}
      monsterInstances={monsterInstances}
      monsters={monsters}
    />
  ) : null;
}

function MapDescriptionPanelInner({
  participant,
  isDm,
  characters,
  monsterInstances,
  monsters,
}: {
  participant: SnapshotParticipant;
  isDm: boolean;
  characters: Character[] | undefined;
  monsterInstances: MonsterInstance[] | undefined;
  monsters: MonsterCatalogEntry[] | undefined;
}) {
  const { t } = useLocale();
  const [collapsed, setCollapsed] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  const resolved = useResolvedEntity(participant, characters, monsterInstances, monsters);

  const saveMutation = useMutation({
    mutationFn: (text: string) => {
      if (!resolved?.save) throw new Error('Not editable');
      return resolved.save(text);
    },
    onSuccess: () => setEditing(false),
  });

  if (!resolved) return null;

  function startEditing() {
    setDraft(resolved!.description);
    setEditing(true);
  }

  return (
    <div className="flex-shrink-0 rounded-md bg-stone-950 shadow-sm border border-stone-800">
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
        aria-expanded={!collapsed}
      >
        <div className="min-w-0">
          <span className="text-sm font-medium text-stone-100 truncate">{resolved.heading}</span>
          {resolved.subheading && <span className="ml-2 text-xs text-stone-500">{resolved.subheading}</span>}
        </div>
        <span className="text-stone-500 text-xs flex-shrink-0">{collapsed ? t('encounters.descriptionPanel.expand') : t('encounters.descriptionPanel.collapse')}</span>
      </button>

      {!collapsed && (
        <div className="px-3 pb-3 space-y-2">
          {resolved.loading && <Loading />}
          {!resolved.loading && saveMutation.isError && <ErrorBanner message={errorMessage(saveMutation.error)} />}
          {!resolved.loading && editing && (
            <div className="space-y-2">
              <Textarea rows={4} value={draft} onChange={(e) => setDraft(e.target.value)} />
              <div className="flex gap-2">
                <Button variant="primary" size="sm" disabled={saveMutation.isPending} onClick={() => saveMutation.mutate(draft)}>
                  {saveMutation.isPending ? t('encounters.descriptionPanel.saving') : t('encounters.descriptionPanel.save')}
                </Button>
                <Button variant="secondary" size="sm" onClick={() => setEditing(false)} disabled={saveMutation.isPending}>
                  {t('encounters.descriptionPanel.cancel')}
                </Button>
              </div>
            </div>
          )}
          {!resolved.loading && !editing && (
            <div className="space-y-2">
              {resolved.description ? (
                <p className="text-sm text-stone-300 whitespace-pre-wrap">{resolved.description}</p>
              ) : (
                <p className="text-sm text-stone-500 italic">{t('encounters.descriptionPanel.empty')}</p>
              )}
              {isDm && (
                <Button variant="secondary" size="sm" onClick={startEditing}>
                  {t('encounters.descriptionPanel.edit')}
                </Button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

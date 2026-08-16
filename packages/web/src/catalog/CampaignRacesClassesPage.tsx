// Campaign race/class curation — mirrors ItemRepositoryPage.tsx's
// browse-catalog-and-import-below pattern, generalized over two entity types
// (races, classes) via a Select switcher, same idea as CatalogEditorPage's
// entity switcher but scoped to just these two. DM-only, matching
// ItemRepositoryPage/MonstersPage's campaign-management gating — "create/
// duplicate your own race or class" already has a full UI at
// /campaigns/:id/catalog (CatalogEditorPage.tsx); this page is about
// choosing which catalog entries this campaign has adopted and giving them a
// local, campaign-scoped tweak without touching the shared catalog row.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { CampaignRaceEntry, CampaignClassEntry, RaceCatalog, ClassCatalog } from '../lib/types';
import { useCampaignShell } from '../campaigns/CampaignShell';
import { useLocale } from '../i18n/LocaleContext';
import { Loading, ErrorBanner, EmptyState, errorMessage } from '../components/Feedback';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Modal } from '../components/ui/Modal';
import { Select, Field, Textarea, Input } from '../components/ui/Field';

type EntityType = 'races' | 'classes';

export function CampaignRacesClassesPage() {
  const { campaignId, campaign, role } = useCampaignShell();
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const [entityType, setEntityType] = useState<EntityType>('races');
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);

  const isRaces = entityType === 'races';
  const catalogListKey = isRaces ? 'races' : 'classes';
  const entriesEndpoint = `/campaigns/${campaignId}/${entityType}`;

  const catalogQuery = useQuery({
    queryKey: ['catalog', entityType, campaign.srd_edition, campaignId],
    queryFn: () =>
      api.get<{ races?: RaceCatalog[]; classes?: ClassCatalog[] }>(
        `/catalog/${entityType}?edition=${campaign.srd_edition}&campaignId=${campaignId}`,
      ),
  });

  const entriesQuery = useQuery({
    queryKey: ['campaignRacesClasses', entityType, campaignId],
    queryFn: () => api.get<{ entries: (CampaignRaceEntry | CampaignClassEntry)[] }>(entriesEndpoint),
  });

  const importMutation = useMutation({
    mutationFn: (catalogId: string) =>
      api.post(entriesEndpoint, isRaces ? { raceIds: [catalogId] } : { classIds: [catalogId] }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['campaignRacesClasses', entityType, campaignId] });
    },
  });

  const removeMutation = useMutation({
    mutationFn: (entryId: string) => api.delete(`${entriesEndpoint}/${entryId}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['campaignRacesClasses', entityType, campaignId] });
    },
  });

  if (role !== 'dm') {
    return (
      <div className="px-4 sm:px-6 py-6 max-w-3xl mx-auto">
        <ErrorBanner message={t('campaignRacesClasses.dmOnly')} />
      </div>
    );
  }

  const catalogEntries = (isRaces ? catalogQuery.data?.races : catalogQuery.data?.classes) ?? [];
  const importedCatalogIds = new Set(
    (entriesQuery.data?.entries ?? []).map((e) => (isRaces ? (e as CampaignRaceEntry).race_id : (e as CampaignClassEntry).class_id)),
  );
  const editingEntry = entriesQuery.data?.entries.find((e) => e.id === editingEntryId) ?? null;

  return (
    <div className="px-4 sm:px-6 py-6 max-w-5xl mx-auto space-y-8">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="font-display text-lg font-medium">{t('campaignRacesClasses.heading')}</h2>
          <p className="text-sm text-stone-400">{t('campaignRacesClasses.subtitle')}</p>
        </div>
        <Select value={entityType} onChange={(e) => setEntityType(e.target.value as EntityType)} className="max-w-xs">
          <option value="races">{t('campaignRacesClasses.races')}</option>
          <option value="classes">{t('campaignRacesClasses.classes')}</option>
        </Select>
      </div>

      <section>
        <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
          <h3 className="text-lg font-semibold">{t('campaignRacesClasses.catalogHeading')}</h3>
          <Link to={`/campaigns/${campaignId}/catalog`} className="text-xs text-amber-500 hover:text-amber-400 underline">
            {t('campaignRacesClasses.manageCatalogLink')}
          </Link>
        </div>

        {importMutation.isError && <ErrorBanner message={errorMessage(importMutation.error)} />}
        {catalogQuery.isLoading && <Loading />}
        {catalogQuery.isError && <ErrorBanner message={errorMessage(catalogQuery.error)} />}

        {catalogQuery.data && catalogEntries.length === 0 && <EmptyState message={t('campaignRacesClasses.catalogEmpty')} />}

        <ul className="grid sm:grid-cols-2 gap-3">
          {catalogEntries.map((entry) => {
            const alreadyImported = importedCatalogIds.has(entry.id);
            return (
              <li key={entry.id} className="rounded-md bg-stone-900 shadow-sm p-4 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <span className="font-medium text-stone-100 truncate">{entry.name}</span>
                  {entry.is_homebrew && (
                    <Badge className="ml-2" variant="accent">
                      {t('campaignRacesClasses.homebrewBadge')}
                    </Badge>
                  )}
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={alreadyImported || importMutation.isPending}
                  onClick={() => importMutation.mutate(entry.id)}
                >
                  {alreadyImported ? t('campaignRacesClasses.imported') : t('campaignRacesClasses.import')}
                </Button>
              </li>
            );
          })}
        </ul>
      </section>

      <section>
        <h3 className="text-lg font-semibold mb-3">{t('campaignRacesClasses.importedHeading')}</h3>
        {entriesQuery.isLoading && <Loading />}
        {entriesQuery.isError && <ErrorBanner message={errorMessage(entriesQuery.error)} />}
        {removeMutation.isError && <ErrorBanner message={errorMessage(removeMutation.error)} />}
        {entriesQuery.data && entriesQuery.data.entries.length === 0 && (
          <EmptyState message={t('campaignRacesClasses.importedEmpty')} />
        )}

        <ul className="grid sm:grid-cols-2 gap-3">
          {entriesQuery.data?.entries.map((entry) => {
            const template = isRaces ? (entry as CampaignRaceEntry).race : (entry as CampaignClassEntry).class;
            const hasOverrides = Object.keys(entry.overrides).length > 0;
            return (
              <li key={entry.id} className="rounded-md bg-stone-900 shadow-sm p-4">
                <div className="flex items-center justify-between mb-2 gap-2">
                  <div className="min-w-0">
                    <span className="font-medium text-stone-100 truncate">{entry.custom_name || template.name}</span>
                    {hasOverrides && (
                      <Badge className="ml-2" variant="accent">
                        {t('campaignRacesClasses.overriddenBadge')}
                      </Badge>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => removeMutation.mutate(entry.id)}
                    className="text-red-400 hover:text-red-300 text-xs flex-shrink-0"
                    aria-label={t('campaignRacesClasses.removeAria')}
                  >
                    ✕
                  </button>
                </div>
                <Button variant="secondary" size="sm" onClick={() => setEditingEntryId(entry.id)}>
                  {t('campaignRacesClasses.editOverride')}
                </Button>
              </li>
            );
          })}
        </ul>
      </section>

      {editingEntry && (
        <EditEntryModal
          key={editingEntry.id}
          entry={editingEntry}
          entityType={entityType}
          entriesEndpoint={entriesEndpoint}
          catalogListKey={catalogListKey}
          onClose={() => setEditingEntryId(null)}
        />
      )}
    </div>
  );
}

function EditEntryModal({
  entry,
  entityType,
  entriesEndpoint,
  catalogListKey,
  onClose,
}: {
  entry: CampaignRaceEntry | CampaignClassEntry;
  entityType: EntityType;
  entriesEndpoint: string;
  catalogListKey: string;
  onClose: () => void;
}) {
  const { t } = useLocale();
  const { campaignId } = useCampaignShell();
  const queryClient = useQueryClient();
  const [customName, setCustomName] = useState(entry.custom_name ?? '');
  const [notes, setNotes] = useState(entry.notes ?? '');
  const [overridesText, setOverridesText] = useState(JSON.stringify(entry.overrides, null, 2));
  const [jsonError, setJsonError] = useState<string | null>(null);

  const updateMutation = useMutation({
    mutationFn: (overrides: Record<string, unknown>) =>
      api.patch(`${entriesEndpoint}/${entry.id}`, {
        customName: customName.trim() === '' ? null : customName,
        notes: notes.trim() === '' ? null : notes,
        overrides,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['campaignRacesClasses', entityType, campaignId] });
      onClose();
    },
  });

  function handleSave() {
    let parsed: Record<string, unknown>;
    try {
      parsed = overridesText.trim() === '' ? {} : JSON.parse(overridesText);
    } catch {
      setJsonError(t('campaignRacesClasses.invalidJson'));
      return;
    }
    setJsonError(null);
    updateMutation.mutate(parsed);
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={t('campaignRacesClasses.editModalTitle', { name: entry.custom_name || (catalogListKey === 'races' ? (entry as CampaignRaceEntry).race.name : (entry as CampaignClassEntry).class.name) })}
      size="lg"
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('campaignRacesClasses.cancel')}
          </Button>
          <Button variant="primary" onClick={handleSave} disabled={updateMutation.isPending}>
            {t('campaignRacesClasses.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {updateMutation.isError && <ErrorBanner message={errorMessage(updateMutation.error)} />}
        {jsonError && <ErrorBanner message={jsonError} />}
        <Field label={t('campaignRacesClasses.customNameLabel')} htmlFor="campaign-entry-custom-name">
          <Input id="campaign-entry-custom-name" value={customName} onChange={(e) => setCustomName(e.target.value)} />
        </Field>
        <Field label={t('campaignRacesClasses.notesLabel')} htmlFor="campaign-entry-notes">
          <Textarea id="campaign-entry-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <Field
          label={t('campaignRacesClasses.overridesLabel')}
          htmlFor="campaign-entry-overrides"
          hint={t('campaignRacesClasses.overridesHint')}
        >
          <Textarea
            id="campaign-entry-overrides"
            rows={8}
            className="font-mono text-xs"
            value={overridesText}
            onChange={(e) => setOverridesText(e.target.value)}
          />
        </Field>
      </div>
    </Modal>
  );
}

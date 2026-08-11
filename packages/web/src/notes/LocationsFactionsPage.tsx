import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { Faction, Location } from '../lib/types';
import { useCampaignShell } from '../campaigns/CampaignShell';
import { Loading, ErrorBanner, EmptyState, errorMessage } from '../components/Feedback';
import { Field, Input, Textarea } from '../components/ui/Field';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Modal } from '../components/ui/Modal';
import { useFormDraft } from '../lib/useFormDraft';
import { useLocale, type TranslationKey } from '../i18n/LocaleContext';

interface EntityFormValues {
  name: string;
  description: string;
  notes: string;
}

function emptyEntityForm(): EntityFormValues {
  return { name: '', description: '', notes: '' };
}

// Locations and factions (Phase 3 "locations and factions") are identical in
// shape and authorization — name/description/notes, all-member read, DM-only
// write (services/locations.ts, services/factions.ts) — so one generic
// section drives both tabs below rather than duplicating the same CRUD UI
// twice. `kind` picks the API path and the (already-namespaced-by-kind)
// translation keys.
type EntityKind = 'locations' | 'factions';
type SimpleEntity = Location | Faction;

function EntitySection({ campaignId, isDm, kind }: { campaignId: string; isDm: boolean; kind: EntityKind }) {
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [editingEntity, setEditingEntity] = useState<SimpleEntity | null>(null);

  const listQuery = useQuery({
    queryKey: [kind, campaignId],
    queryFn: () => api.get<Record<EntityKind, SimpleEntity[]>>(`/campaigns/${campaignId}/${kind}`),
  });
  const entities = listQuery.data?.[kind] ?? [];

  const [form, setForm, clearDraft] = useFormDraft(`draft:${kind}:new:${campaignId}`, emptyEntityForm);

  const singular = kind === 'locations' ? 'location' : 'faction';
  const newLabelKey: TranslationKey = kind === 'locations' ? 'locationsFactions.newLocation' : 'locationsFactions.newFaction';
  const noEntitiesKey: TranslationKey = kind === 'locations' ? 'locationsFactions.noLocations' : 'locationsFactions.noFactions';
  const deleteConfirmKey: TranslationKey =
    kind === 'locations' ? 'locationsFactions.deleteLocationConfirm' : 'locationsFactions.deleteFactionConfirm';
  const editTitleKey: TranslationKey =
    kind === 'locations' ? 'locationsFactions.editLocationTitle' : 'locationsFactions.editFactionTitle';

  const createMutation = useMutation({
    mutationFn: () =>
      api.post<Record<'location' | 'faction', SimpleEntity>>(`/campaigns/${campaignId}/${kind}`, {
        name: form.name,
        description: form.description || undefined,
        notes: form.notes || undefined,
      }),
    onSuccess: () => {
      setForm(emptyEntityForm());
      clearDraft();
      setShowCreate(false);
      void queryClient.invalidateQueries({ queryKey: [kind, campaignId] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (entityId: string) => api.delete(`/campaigns/${campaignId}/${kind}/${entityId}`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: [kind, campaignId] }),
  });

  function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return;
    createMutation.mutate();
  }

  return (
    <div>
      {isDm && (
        <div className="flex justify-end mb-4">
          <Button variant="primary" size="sm" onClick={() => setShowCreate((v) => !v)}>
            {showCreate ? t('locationsFactions.cancel') : t(newLabelKey)}
          </Button>
        </div>
      )}

      {isDm && showCreate && (
        <Card as="form" onSubmit={handleCreate} className="mb-6 gap-4">
          <Field label={t('locationsFactions.nameLabel')} htmlFor={`${singular}Name`}>
            <Input id={`${singular}Name`} required value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          </Field>
          <Field label={t('locationsFactions.descriptionLabel')} htmlFor={`${singular}Description`}>
            <Textarea
              id={`${singular}Description`}
              rows={3}
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            />
          </Field>
          <Field label={t('locationsFactions.notesLabel')} htmlFor={`${singular}Notes`}>
            <Textarea
              id={`${singular}Notes`}
              rows={3}
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            />
          </Field>
          {createMutation.isError && <ErrorBanner message={errorMessage(createMutation.error)} />}
          <Button type="submit" variant="primary" disabled={createMutation.isPending}>
            {createMutation.isPending ? t('locationsFactions.saving') : t('locationsFactions.save')}
          </Button>
        </Card>
      )}

      {listQuery.isLoading && <Loading />}
      {listQuery.isError && <ErrorBanner message={errorMessage(listQuery.error)} />}
      {listQuery.data && entities.length === 0 && <EmptyState message={t(noEntitiesKey)} />}
      {deleteMutation.isError && <ErrorBanner message={errorMessage(deleteMutation.error)} />}

      <ul className="space-y-3">
        {entities.map((entity) => (
          <li key={entity.id}>
            <Card>
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-medium text-stone-100">{entity.name}</h3>
                {isDm && (
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button
                      type="button"
                      onClick={() => setEditingEntity(entity)}
                      className="min-h-11 px-1 text-amber-500 hover:text-amber-400 text-xs"
                    >
                      {t('locationsFactions.edit')}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (window.confirm(t(deleteConfirmKey, { name: entity.name }))) deleteMutation.mutate(entity.id);
                      }}
                      className="min-h-11 px-1 text-red-400 hover:text-red-300 text-xs"
                    >
                      {t('locationsFactions.delete')}
                    </button>
                  </div>
                )}
              </div>
              {entity.description && <p className="text-sm text-stone-300 whitespace-pre-wrap">{entity.description}</p>}
              {entity.notes && <p className="text-xs text-stone-500 whitespace-pre-wrap">{entity.notes}</p>}
            </Card>
          </li>
        ))}
      </ul>

      <EntityEditModal
        campaignId={campaignId}
        kind={kind}
        entity={editingEntity}
        editTitleKey={editTitleKey}
        onClose={() => setEditingEntity(null)}
      />
    </div>
  );
}

function EntityEditModal({
  campaignId,
  kind,
  entity,
  editTitleKey,
  onClose,
}: {
  campaignId: string;
  kind: EntityKind;
  entity: SimpleEntity | null;
  editTitleKey: TranslationKey;
  onClose: () => void;
}) {
  if (entity === null) return null;
  return <EntityEditForm campaignId={campaignId} kind={kind} entity={entity} editTitleKey={editTitleKey} onClose={onClose} />;
}

function EntityEditForm({
  campaignId,
  kind,
  entity,
  editTitleKey,
  onClose,
}: {
  campaignId: string;
  kind: EntityKind;
  entity: SimpleEntity;
  editTitleKey: TranslationKey;
  onClose: () => void;
}) {
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const singular = kind === 'locations' ? 'location' : 'faction';
  const draftKey = `draft:${kind}:edit:${entity.id}`;
  const [form, setForm, clearDraft] = useFormDraft<EntityFormValues>(draftKey, () => ({
    name: entity.name,
    description: entity.description ?? '',
    notes: entity.notes ?? '',
  }));

  const updateMutation = useMutation({
    mutationFn: () =>
      api.patch<Record<'location' | 'faction', SimpleEntity>>(`/campaigns/${campaignId}/${kind}/${entity.id}`, {
        name: form.name,
        description: form.description || null,
        notes: form.notes || null,
      }),
    onSuccess: () => {
      clearDraft();
      void queryClient.invalidateQueries({ queryKey: [kind, campaignId] });
      onClose();
    },
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return;
    updateMutation.mutate();
  }

  return (
    <Modal open onClose={onClose} title={t(editTitleKey)}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Field label={t('locationsFactions.nameLabel')} htmlFor={`${singular}EditName`}>
          <Input
            id={`${singular}EditName`}
            required
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          />
        </Field>
        <Field label={t('locationsFactions.descriptionLabel')} htmlFor={`${singular}EditDescription`}>
          <Textarea
            id={`${singular}EditDescription`}
            rows={3}
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          />
        </Field>
        <Field label={t('locationsFactions.notesLabel')} htmlFor={`${singular}EditNotes`}>
          <Textarea
            id={`${singular}EditNotes`}
            rows={3}
            value={form.notes}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
          />
        </Field>
        {updateMutation.isError && <ErrorBanner message={errorMessage(updateMutation.error)} />}
        <div className="flex gap-2">
          <Button type="submit" variant="primary" disabled={updateMutation.isPending}>
            {updateMutation.isPending ? t('locationsFactions.saving') : t('locationsFactions.saveChanges')}
          </Button>
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('locationsFactions.cancel')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/**
 * Phase 3 "locations and factions" — DM-authored world reference data,
 * visible to every campaign member, DM-only to create/edit/delete. Both
 * entity kinds share an identical shape server-side (services/locations.ts,
 * services/factions.ts), so this page is a thin tab switch over the one
 * generic EntitySection above rather than two near-duplicate pages.
 */
export function LocationsFactionsPage() {
  const { t } = useLocale();
  const { campaignId, role } = useCampaignShell();
  const isDm = role === 'dm';
  const [tab, setTab] = useState<EntityKind>('locations');

  return (
    <div className="px-4 sm:px-6 py-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-display text-lg font-medium">{t('locationsFactions.title')}</h2>
      </div>

      <div className="flex gap-2 mb-4 border-b border-stone-800">
        <button
          type="button"
          onClick={() => setTab('locations')}
          className={`min-h-11 px-3 text-sm font-medium border-b-2 -mb-px ${
            tab === 'locations' ? 'border-amber-500 text-amber-400' : 'border-transparent text-stone-400 hover:text-stone-200'
          }`}
        >
          {t('locationsFactions.tabLocations')}
        </button>
        <button
          type="button"
          onClick={() => setTab('factions')}
          className={`min-h-11 px-3 text-sm font-medium border-b-2 -mb-px ${
            tab === 'factions' ? 'border-amber-500 text-amber-400' : 'border-transparent text-stone-400 hover:text-stone-200'
          }`}
        >
          {t('locationsFactions.tabFactions')}
        </button>
      </div>

      <EntitySection key={tab} campaignId={campaignId} isDm={isDm} kind={tab} />
    </div>
  );
}
